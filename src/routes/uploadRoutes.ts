// File: src/routes/upload.ts
import express, { Request, Response } from "express";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import axios from "axios";
import { encode } from "gpt-3-encoder";

interface MulterRequest extends Request {
  file?: Express.Multer.File;
  user?: { userId: string; email: string };
}

const router = express.Router();
const prisma = new PrismaClient();

// Logging middleware
router.use((req: Request, _res: Response, next: Function) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Multer in-memory
const upload = multer({ storage: multer.memoryStorage() });

// GCS config
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files");
const summaryBucket = storage.bucket("deposition-summaries");

console.log("Using deposition bucket:", depositionBucket.name);
console.log("Using summary bucket:", summaryBucket.name);

// Azure OpenAI helper (with retry)
async function azureChatCompletion(
  messages: { role: string; content: string }[],
  max_tokens: number,
  retries = 3
): Promise<any> {
  const endpoint = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=${process.env.AZURE_API_VERSION}`;
  const payload = { messages, max_tokens, temperature: 0.3 };
  const headers = {
    "Content-Type": "application/json",
    "api-key": process.env.AZURE_OPENAI_API_KEY!,
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.post(endpoint, payload, { headers });
      return response.data;
    } catch (err: any) {
      if (err.response?.status === 429) {
        const retryAfter = parseInt(
          err.response.headers["retry-after"] || "5",
          10
        );
        console.warn(
          `Rate limited; retrying in ${retryAfter}s (attempt ${attempt + 1})`
        );
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
      } else {
        console.error("Azure OpenAI error:", err);
        throw err;
      }
    }
  }
  throw new Error("Failed after retries.");
}

function splitIntoChunks(text: string, chunkSizeChars = 1000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSizeChars) {
    chunks.push(text.slice(i, i + chunkSizeChars));
  }
  return chunks;
}

async function summarizeChunk(chunk: string): Promise<string> {
  const prompt = `Summarize the following text:\n\n${chunk}`;
  console.log("Chunk token count:", encode(prompt).length);
  try {
    const resp = await azureChatCompletion(
      [
        { role: "system", content: "You are a helpful summarizer." },
        { role: "user", content: prompt },
      ],
      700
    );
    return resp.choices[0].message?.content.trim() ?? "";
  } catch (err) {
    console.error("Chunk summarization error:", err);
    return "";
  }
}

async function summarizeAll(partials: string[]): Promise<string> {
  const joined = partials.join("\n\n");
  const prompt = `Combine and summarize these partial summaries:\n\n${joined}`;
  console.log("Combined prompt token count:", encode(prompt).length);
  try {
    const resp = await azureChatCompletion(
      [
        { role: "system", content: "You are a helpful summarizer." },
        { role: "user", content: prompt },
      ],
      700
    );
    return (
      resp.choices[0].message?.content.trim() ?? "No final summary generated."
    );
  } catch (err) {
    console.error("Final summary error:", err);
    return partials.join("\n\n");
  }
}

async function summarizeChunksConcurrently(
  chunks: string[]
): Promise<string[]> {
  const partials: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    partials.push(await summarizeChunk(chunks[i]));
  }
  return partials;
}

// POST /upload
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req: MulterRequest, res: Response) => {
    try {
      // ← NEW: pull user-entered fields
      const { summaryName, deponent } = req.body as {
        summaryName: string;
        deponent: string;
      };

      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (user.credits < 1) {
        res.status(403).json({
          error: "Not enough credits",
          redirectTo: "/dashboard/checkout/packages",
        });
        return;
      }

      // Subtract 1 credit
      await prisma.user.update({
        where: { id: userId },
        data: { credits: user.credits - 1 },
      });

      // Upload original
      const originalName = req.file.originalname;
      const fileBuffer = req.file.buffer;
      const originalBlob = depositionBucket.file(originalName);
      const originalBlobStream = originalBlob.createWriteStream({
        resumable: false,
      });
      await new Promise<void>((resolve, reject) => {
        originalBlobStream.on("error", reject);
        originalBlobStream.on("finish", resolve);
        originalBlobStream.end(fileBuffer);
      });
      const originalUrl = `https://storage.googleapis.com/${depositionBucket.name}/${originalBlob.name}`;
      console.log(`Uploaded original: ${originalName}`);

      // Extract text
      let fileText: string;
      if (originalName.toLowerCase().endsWith(".pdf")) {
        fileText = (await pdfParse(fileBuffer)).text;
      } else if (/\.(doc|docx)$/.test(originalName.toLowerCase())) {
        fileText = (await mammoth.extractRawText({ buffer: fileBuffer })).value;
      } else {
        fileText = fileBuffer.toString("utf-8");
      }
      if (!fileText.trim()) fileText = "No text extracted.";

      // Summarize
      let finalSummary = "";
      if (fileText.length < 14_000) {
        const prompt = `Summarize the following deposition text:\n\n${fileText}`;
        console.log("Single-chunk token count:", encode(prompt).length);
        try {
          const summaryResp = await azureChatCompletion(
            [
              { role: "system", content: "You are a helpful summarizer." },
              { role: "user", content: prompt },
            ],
            700
          );
          finalSummary = summaryResp.choices[0].message?.content.trim() ?? "";
        } catch (err) {
          console.error("Single-chunk error:", err);
          finalSummary = "Failed to summarize.";
        }
      } else {
        const chunks = splitIntoChunks(fileText, 1000);
        const partials = await summarizeChunksConcurrently(chunks);
        finalSummary = await summarizeAll(partials);
      }
      console.log("Final summary generated.");

      // Upload summary
      const safeName = originalName.replace(/\s+/g, "-").toLowerCase();
      const summaryFileName = `summary-${safeName}-${Date.now()}.txt`;
      const summaryBlob = summaryBucket.file(summaryFileName);
      const summaryStream = summaryBlob.createWriteStream({
        resumable: false,
        contentType: "text/plain",
      });
      await new Promise<void>((resolve, reject) => {
        summaryStream.on("error", reject);
        summaryStream.on("finish", resolve);
        summaryStream.end(finalSummary);
      });
      const [summaryUrl] = await summaryBlob.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 3 * 24 * 60 * 60 * 1000,
      });
      console.log(`Uploaded summary: ${summaryFileName}`);

      // ← NEW: save title & deponent
      const savedFile = await prisma.file.create({
        data: {
          fileName: originalName,
          fileUrl: originalUrl,
          summaryFileName,
          summaryUrl,
          title: summaryName,
          deponent,
          userId,
        },
      });

      res.json({
        message: "File uploaded and summarized successfully",
        id: savedFile.id,
        title: savedFile.title,
        fileUrl: savedFile.fileUrl,
        summaryUrl: savedFile.summaryUrl,
        createdAt: savedFile.createdAt,
      });
    } catch (err) {
      console.error("Upload route error:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

// GET /summaries
router.get(
  "/summaries",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const files = await prisma.file.findMany({
        where: { userId, summaryUrl: { not: null } },
        select: {
          id: true,
          title: true, // ← now returning the user’s custom name
          summaryUrl: true,
          createdAt: true,
          pages: true,
        },
      });

      // build the shape your UI needs
      const payload = files.map((f) => ({
        id: f.id,
        title: f.title,
        date: f.createdAt.toISOString(),
        pages: f.pages,
        status:
          Date.now() - f.createdAt.getTime() <= 3 * 24 * 60 * 60 * 1000
            ? "Active"
            : "Expired",
      }));

      res.json(payload);
    } catch (err) {
      console.error("Error fetching summaries:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

export default router;

// src/routes/uploadRoutes.ts
import express, { Request, Response } from "express";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

interface MulterRequest extends Request {
  file?: Express.Multer.File;
  user?: { userId: string; email: string };
}

const router = express.Router();
const prisma = new PrismaClient();

// Multer in-memory
const upload = multer({ storage: multer.memoryStorage() });

// GCS config
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files");
const summaryBucket = storage.bucket("deposition-summaries");

console.log("Using deposition bucket:", depositionBucket.name);
console.log("Using summary bucket:", summaryBucket.name);

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper to chunk text for large docs
function splitIntoChunks(text: string, chunkSizeChars = 4000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSizeChars, text.length);
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function summarizeChunk(chunk: string): Promise<string> {
  const prompt = `Summarize the following text:\n\n${chunk}`;
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful summarizer." },
        { role: "user", content: prompt },
      ],
      max_tokens: 700,
    });
    const raw = resp.choices[0].message?.content;
    return raw ? raw.trim() : "";
  } catch (err) {
    console.error("Chunk summarization error:", err);
    return "";
  }
}

async function summarizeAll(partials: string[]): Promise<string> {
  const joined = partials.join("\n\n");
  const prompt = `Combine and summarize these partial summaries:\n\n${joined}`;
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful summarizer." },
        { role: "user", content: prompt },
      ],
      max_tokens: 700,
    });
    const raw = resp.choices[0].message?.content;
    return raw ? raw.trim() : "No final summary generated.";
  } catch (err) {
    console.error("Final summary error:", err);
    return partials.join("\n\n");
  }
}

// POST /upload
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req: MulterRequest, res: Response): Promise<void> => {
    try {
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

      // Check credits
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

      // Upload original file to GCS
      const fileBuffer = req.file.buffer;
      const originalName = req.file.originalname;

      const originalBlob = depositionBucket.file(originalName);
      const originalBlobStream = originalBlob.createWriteStream({
        resumable: false,
      });
      await new Promise<void>((resolve, reject) => {
        originalBlobStream.on("error", reject);
        originalBlobStream.on("finish", resolve);
        originalBlobStream.end(fileBuffer);
      });
      console.log(`Original file ${originalName} uploaded.`);

      const originalUrl = `https://storage.googleapis.com/${depositionBucket.name}/${originalBlob.name}`;

      // Extract text
      let fileText: string;
      if (originalName.toLowerCase().endsWith(".pdf")) {
        const pdfData = await pdfParse(fileBuffer);
        fileText = pdfData.text;
      } else if (
        originalName.toLowerCase().endsWith(".doc") ||
        originalName.toLowerCase().endsWith(".docx")
      ) {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        fileText = result.value;
      } else {
        fileText = fileBuffer.toString("utf-8");
      }

      if (!fileText || fileText.trim().length === 0) {
        fileText = "No text extracted. Possibly a scanned doc.";
      }

      // Summarize with chunking
      let finalSummary = "";
      if (fileText.length < 14000) {
        // single chunk
        try {
          const prompt = `Summarize the following deposition text:\n\n${fileText}`;
          const summaryResp = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: "You are a helpful summarizer." },
              { role: "user", content: prompt },
            ],
            max_tokens: 700,
          });
          const raw = summaryResp.choices[0].message?.content;
          finalSummary = raw ? raw.trim() : "No summary generated.";
        } catch (err) {
          console.error("Single-chunk error:", err);
          finalSummary = "Failed to summarize. Possibly too large or error.";
        }
      } else {
        // chunk approach
        const chunks = splitIntoChunks(fileText, 3000);
        const partials: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const csum = await summarizeChunk(chunks[i]);
          partials.push(csum);
        }
        finalSummary = await summarizeAll(partials);
      }

      console.log("Final summary generated:", finalSummary);

      // Upload summary as text
      const safeName = originalName.replace(/\s+/g, "-");
      const summaryFileName = `summary-${safeName}`;
      const summaryBlob = summaryBucket.file(summaryFileName);
      const summaryBlobStream = summaryBlob.createWriteStream({
        resumable: false,
        contentType: "text/plain",
      });
      await new Promise<void>((resolve, reject) => {
        summaryBlobStream.on("error", reject);
        summaryBlobStream.on("finish", resolve);
        summaryBlobStream.end(finalSummary);
      });
      console.log(`Summary file ${summaryFileName} uploaded.`);

      // Signed URL for raw text
      const [summaryUrl] = await summaryBlob.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 3 * 24 * 60 * 60 * 1000,
      });

      // Save DB record
      const savedFile = await prisma.file.create({
        data: {
          fileName: originalName,
          fileUrl: originalUrl,
          summaryFileName,
          summaryUrl,
          userId,
        },
      });

      res.json({
        message: "File uploaded and summarized successfully",
        fileName: savedFile.fileName,
        fileUrl: savedFile.fileUrl,
        summaryUrl: savedFile.summaryUrl,
        userId: savedFile.userId,
      });
    } catch (err) {
      console.error("Upload route error:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

// GET /summaries
// GET /summaries
router.get(
  "/summaries",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const summaries = await prisma.file.findMany({
        where: {
          userId,
          summaryUrl: { not: null },
        },
        select: {
          id: true,
          fileName: true,
          fileUrl: true,
          summaryFileName: true,
          summaryUrl: true,
          createdAt: true,
          pages: true,
        },
      });

      // Compute status based on creation date
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const enhancedSummaries = summaries.map((file) => {
        const fileTime = new Date(file.createdAt).getTime();
        // If the file was created within the last 3 days, status is "Active", otherwise "Expired"
        const status = now - fileTime <= threeDaysMs ? "Active" : "Expired";
        return { ...file, status };
      });

      res.json(enhancedSummaries);
    } catch (err) {
      console.error("Error fetching summaries:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);
export default router;

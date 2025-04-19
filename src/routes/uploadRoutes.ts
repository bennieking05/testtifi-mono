// File: src/routes/uploadRoutes.ts
import express, { Request, Response } from "express";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import mammoth from "mammoth";
import vision from "@google-cloud/vision";
import axios from "axios";
import pdf from "pdf-parse";

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });
const storage = new Storage();
const visionClient = new vision.ImageAnnotatorClient();
const depositionBucket = storage.bucket("deposition-files");
const summaryBucket = storage.bucket("deposition-summaries");

// Azure OpenAI chat helper
async function azureChatCompletion(
  messages: { role: string; content: string }[],
  max_tokens: number,
  retries = 3
): Promise<any> {
  const endpoint =
    `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/` +
    `${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=` +
    `${process.env.AZURE_API_VERSION}`;
  const headers = {
    "Content-Type": "application/json",
    "api-key": process.env.AZURE_OPENAI_API_KEY!,
  };
  const payload = { messages, max_tokens, temperature: 0.3 };

  for (let i = 0; i < retries; i++) {
    try {
      const resp = await axios.post(endpoint, payload, { headers });
      return resp.data;
    } catch (err: any) {
      if (err.response?.status === 429) {
        const wait = parseInt(err.response.headers["retry-after"] || "5", 10);
        await new Promise((r) => setTimeout(r, wait * 1000));
      } else {
        throw err;
      }
    }
  }
  throw new Error("Azure OpenAI retries exhausted");
}

// Extract text from large PDF using Google Vision asyncBatchAnnotateFiles
async function extractTextFromLargePDFViaGCS(gcsUri: string): Promise<string> {
  const destinationUri = `gs://${summaryBucket.name}/vision-output/`;

  const [operation] = await visionClient.asyncBatchAnnotateFiles({
    requests: [
      {
        inputConfig: {
          gcsSource: { uri: gcsUri },
          mimeType: "application/pdf",
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        outputConfig: {
          gcsDestination: { uri: destinationUri },
          batchSize: 1,
        },
      },
    ],
  });

  await operation.promise();

  const [files] = await summaryBucket.getFiles({
    prefix: "vision-output/output-1-to-1.json",
  });
  const [outputBuffer] = await files[0].download();
  const parsed = JSON.parse(outputBuffer.toString());

  const text = parsed.responses
    .map((res: any) => res.fullTextAnnotation?.text || "")
    .join("\n");

  return text.trim();
}

// Extract full text from supported file types
async function extractFullText(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const isPDF = filename.toLowerCase().endsWith(".pdf");
  const isDocx = /\.(doc|docx)$/i.test(filename);

  if (isPDF) {
    const parsed = await pdf(buffer);
    if (parsed.text.trim().length > 0) {
      return parsed.text.trim();
    }
    return ""; // fallback handled externally
  }

  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }

  return buffer.toString("utf-8").trim();
}

// Summarize the full document contextually
async function summarizeFullText(text: string): Promise<string> {
  const prompt = [
    { role: "system", content: "You are a helpful legal summarizer." },
    {
      role: "user",
      content: `Summarize the following legal deposition in detail. Capture key events, persons, and legal context:\n\n${text}`,
    },
  ];
  const resp = await azureChatCompletion(prompt, 1500);
  return resp.choices[0].message.content.trim();
}

// Upload route with GCS-based OCR + summarization
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { summaryName, deponent } = req.body;
      const file = req.file;
      const userId = (req as any).user?.userId;

      if (!file || !userId) {
        res.status(400).json({ error: "Missing file or unauthorized" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.credits < 1) {
        res.status(403).json({ error: "Not enough credits" });
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { credits: user.credits - 1 },
      });

      await depositionBucket.file(file.originalname).save(file.buffer);
      const gcsUri = `gs://${depositionBucket.name}/${file.originalname}`;
      const originalUrl = `https://storage.googleapis.com/${depositionBucket.name}/${file.originalname}`;

      let fullText = await extractFullText(file.buffer, file.originalname);

      if (!fullText || fullText.length < 20) {
        fullText = await extractTextFromLargePDFViaGCS(gcsUri);
      }

      if (!fullText || fullText.length < 20) {
        res
          .status(422)
          .json({ error: "No extractable text found in document." });
        return;
      }

      const summaryText = await summarizeFullText(fullText);

      const summaryData = {
        summary: summaryText,
        uploadedAt: new Date().toISOString(),
        title: summaryName,
        deponent,
      };

      const summaryFileName = `summary-${Date.now()}-${file.originalname}.json`;
      await summaryBucket
        .file(summaryFileName)
        .save(JSON.stringify(summaryData), {
          contentType: "application/json",
        });

      const [summaryUrl] = await summaryBucket
        .file(summaryFileName)
        .getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 259200000,
        });

      const saved = await prisma.file.create({
        data: {
          fileName: file.originalname,
          fileUrl: originalUrl,
          summaryFileName,
          summaryUrl,
          title: summaryName,
          deponent,
          userId,
        },
      });

      res.json({
        message: "File uploaded and summarized using OCR",
        id: saved.id,
        summaryUrl,
      });
    } catch (e) {
      console.error("Upload error:", e);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

export default router;

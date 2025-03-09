// src/routes/uploadRoutes.ts
/// <reference path="../types/pdf-parse.d.ts" />
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
  user?: { userId: string; email: string }; // populated by JWT middleware
}

const router = express.Router();
const prisma = new PrismaClient();

// 1. Multer setup for file parsing (in-memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// 2. Google Cloud Storage config
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files"); // Bucket for original files
const summaryBucket = storage.bucket("deposition-summaries"); // Bucket for summaries

console.log("Using deposition bucket:", depositionBucket.name);
console.log("Using summary bucket:", summaryBucket.name);

// 3. OpenAI API setup using Chat Completions API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// POST /upload — upload a file, generate a summary, and store metadata
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

      // Get file details from multer
      const fileBuffer = req.file.buffer;
      const originalName = req.file.originalname;

      // --- Step 1: Upload Original File to Deposition Bucket ---
      const originalBlob = depositionBucket.file(originalName);
      const originalBlobStream = originalBlob.createWriteStream({
        resumable: false,
      });
      await new Promise<void>((resolve, reject) => {
        originalBlobStream.on("error", reject);
        originalBlobStream.on("finish", resolve);
        originalBlobStream.end(fileBuffer);
      });
      console.log(
        `Original file ${originalName} uploaded to ${depositionBucket.name}.`
      );
      const originalUrl = `https://storage.googleapis.com/${depositionBucket.name}/${originalBlob.name}`;

      // --- Step 2: Extract text from the document ---
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

      const prompt = `Summarize the following deposition text in a concise manner:\n\n${fileText}`;

      const summaryResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a helpful summarizer." },
          { role: "user", content: prompt },
        ],
        max_tokens: 150,
      });

      const rawSummary = summaryResponse.choices[0].message?.content;
      const summaryText = rawSummary
        ? rawSummary.trim()
        : "No summary generated.";
      console.log("Summary generated:", summaryText);

      // --- Step 3: Upload the Summary to the Summaries Bucket ---
      const summaryFileName = `summary-${originalName}`;
      const summaryBlob = summaryBucket.file(summaryFileName);
      const summaryBlobStream = summaryBlob.createWriteStream({
        resumable: false,
        contentType: "text/plain",
      });
      await new Promise<void>((resolve, reject) => {
        summaryBlobStream.on("error", reject);
        summaryBlobStream.on("finish", resolve);
        summaryBlobStream.end(summaryText);
      });
      console.log(
        `Summary file ${summaryFileName} uploaded to ${summaryBucket.name}.`
      );

      // --- Step 4: Generate a Signed URL for the Summary (valid for 3 days) ---
      const options = {
        version: "v4" as const,
        action: "read" as const,
        expires: Date.now() + 3 * 24 * 60 * 60 * 1000, // 3 days in milliseconds
      };
      const [summaryUrl] = await summaryBlob.getSignedUrl(options);

      // --- Step 5: Store File Metadata in Database ---
      const userId = req.user?.userId;
      const savedFile = await prisma.file.create({
        data: {
          fileName: originalName,
          fileUrl: originalUrl,
          summaryFileName: summaryFileName,
          summaryUrl: summaryUrl,
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

// GET /summaries — return all summaries for the logged-in user
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
      // Retrieve file records that have a summary for this user
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
        },
      });
      res.json(summaries);
    } catch (err) {
      console.error("Error fetching summaries:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

export default router;

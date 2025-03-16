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
  user?: { userId: string; email: string }; // from JWT
}

const router = express.Router();
const prisma = new PrismaClient();

// Multer setup
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

// POST /upload
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req: MulterRequest, res: Response): Promise<void> => {
    try {
      // 1) Check if file is provided
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      // 2) Identify user from token
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // 3) Fetch user from DB
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // 4) Check if user has credits
      if (user.credits < 1) {
        // Instead of `return res.status(...)`:
        res.status(403).json({
          error: "Not enough credits",
          redirectTo: "/dashboard/checkout/packages",
        });
        return; // Return void here
      }

      // 5) Subtract 1 credit
      await prisma.user.update({
        where: { id: userId },
        data: { credits: user.credits - 1 },
      });

      // ---- Proceed with your existing logic ----

      // Get file details
      const fileBuffer = req.file.buffer;
      const originalName = req.file.originalname;

      // 5A) Upload original file to GCS
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

      // 5B) Extract text from doc
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

      // 5C) Summarize with OpenAI
      const prompt = `Summarize the following deposition text:\n\n${fileText}`;
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

      // 5D) Upload summary to GCS
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
        summaryBlobStream.end(summaryText);
      });
      console.log(
        `Summary file ${summaryFileName} uploaded to ${summaryBucket.name}.`
      );

      // 5E) Generate a Signed URL for the Summary (3 days)
      const options = {
        version: "v4" as const,
        action: "read" as const,
        expires: Date.now() + 3 * 24 * 60 * 60 * 1000,
      };
      const [summaryUrl] = await summaryBlob.getSignedUrl(options);

      // 5F) Store file record in DB
      const savedFile = await prisma.file.create({
        data: {
          fileName: originalName,
          fileUrl: originalUrl,
          summaryFileName,
          summaryUrl,
          userId,
        },
      });

      // 6) Return success
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

// src/routes/upload.ts

import express, { Response } from "express";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import OpenAI from "openai";

interface MulterRequest extends express.Request {
  file?: Express.Multer.File;
  user?: { userId: string; email: string }; // populated by JWT middleware
}

const router = express.Router();
const prisma = new PrismaClient();

// 1. Multer setup for file parsing (in-memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// 2. Google Cloud Storage config
const storage = new Storage();
const bucket = storage.bucket("deposition-files"); // Replace with your actual GCS bucket name

// 3. OpenAI API setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 4. Protected Upload Endpoint
router.post(
  "/upload",
  authenticateToken, // ensures user is authenticated
  upload.single("file"), // handle a single file upload
  async (req: MulterRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      // Get the file details from multer
      const fileBuffer = req.file.buffer;
      const originalName = req.file.originalname;

      // --- Step 1: Upload Original File to GCS ---
      const originalBlob = bucket.file(originalName);
      const originalBlobStream = originalBlob.createWriteStream({
        resumable: false,
      });
      await new Promise<void>((resolve, reject) => {
        originalBlobStream.on("error", reject);
        originalBlobStream.on("finish", resolve);
        originalBlobStream.end(fileBuffer);
      });
      console.log(`Original file ${originalName} uploaded to GCS.`);
      const originalUrl = `https://storage.googleapis.com/${bucket.name}/${originalBlob.name}`;

      // --- Step 2: Summarize the Document using OpenAI ---
      // Here we assume the file content is plain text.
      // For PDFs or DOC/DOCX files, you’ll need to extract text before summarizing.
      const fileText = fileBuffer.toString("utf-8");
      const prompt = `Summarize the following deposition text in a concise manner:\n\n${fileText}`;

      const summaryResponse = await openai.completions.create({
        model: "text-davinci-003",
        prompt,
        max_tokens: 150,
      });
      const summaryText =
        summaryResponse.choices[0].text?.trim() || "No summary generated.";
      console.log("Summary generated:", summaryText);

      // --- Step 3: Upload the Summary to GCS ---
      const summaryFileName = `summary-${originalName}`;
      const summaryBlob = bucket.file(summaryFileName);
      const summaryBlobStream = summaryBlob.createWriteStream({
        resumable: false,
        contentType: "text/plain",
      });
      await new Promise<void>((resolve, reject) => {
        summaryBlobStream.on("error", reject);
        summaryBlobStream.on("finish", resolve);
        summaryBlobStream.end(summaryText);
      });
      console.log(`Summary file ${summaryFileName} uploaded to GCS.`);

      // --- Step 4: Generate a Signed URL for the Summary ---
      // The URL will be valid for 3 days.
      const options = {
        version: "v4" as const,
        action: "read" as const,
        expires: Date.now() + 3 * 24 * 60 * 60 * 1000, // 3 days in milliseconds
      };
      const [summaryUrl] = await summaryBlob.getSignedUrl(options);

      // --- Step 5: Store File Metadata in Database ---
      const userId = req.user?.userId; // from JWT
      const savedFile = await prisma.file.create({
        data: {
          fileName: originalName,
          fileUrl: originalUrl,
          summaryFileName: summaryFileName, // optional
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

export default router;

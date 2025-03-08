import express, { Response } from "express";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware"; // <-- Import your JWT middleware

interface MulterRequest extends express.Request {
  file?: Express.Multer.File;
  user?: { userId: string; email: string }; // from JWT
}

const router = express.Router();
const prisma = new PrismaClient();

// 1. Multer setup for file parsing
const upload = multer({ storage: multer.memoryStorage() });

// 2. GCS config
const storage = new Storage();
const bucket = storage.bucket("deposition-files"); // Replace with your GCS bucket name

// 3. Protected Upload Endpoint (includes userId)
router.post(
  "/upload",
  authenticateToken, // Ensure the user is authenticated
  upload.single("file"), // Multer to handle single file
  async (req: MulterRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      // The file buffer from multer
      const fileBuffer = req.file.buffer;
      const originalName = req.file.originalname;

      // Upload to GCS
      const blob = bucket.file(originalName);
      const blobStream = blob.createWriteStream({ resumable: false });

      blobStream.on("error", (err) => {
        console.error("GCS upload error:", err);
        res.status(500).json({ error: "Unable to upload file to GCS" });
      });

      blobStream.on("finish", async () => {
        console.log(`File ${originalName} uploaded to GCS.`);

        // GCS public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

        // Retrieve userId from JWT
        const userId = req.user?.userId; // e.g., "abc123"

        // Store metadata in DB with userId
        const savedFile = await prisma.file.create({
          data: {
            fileName: originalName,
            fileUrl: publicUrl,
            userId,
          },
        });

        res.json({
          message: "File uploaded successfully",
          fileName: savedFile.fileName,
          fileUrl: savedFile.fileUrl,
          userId: savedFile.userId,
        });
      });

      blobStream.end(fileBuffer);
    } catch (err) {
      console.error("Upload route error:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

export default router;

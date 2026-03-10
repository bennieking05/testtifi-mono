import express, { Request, Response } from "express";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import pdf from "pdf-parse";
import mammoth from "mammoth";

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 } // 512 MiB cap
});

const storage = new Storage();
const humanSummaryBucket = storage.bucket("deposition-summaries"); // /human/
const pairBucket = storage.bucket("deposition-summaries"); // /pairs/
// const trainingUploadBucket = storage.bucket("deposition-training-data");

// Utility function to extract text from various file formats
async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const isPDF = filename.toLowerCase().endsWith(".pdf");
  const isDocx = /\.(docx?|DOCX?)$/.test(filename);

  if (isPDF) {
    const parsed = await pdf(buffer);
    return parsed.text;
  }

  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  return buffer.toString("utf-8");
}

// Upload human-written summaries
router.post(
  "/upload-human-summary",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;
      const userId = (req as any).user?.userId;
      if (!file || !userId) {
        res.status(400).json({ error: "Missing file or unauthorized" });
        return;
      }

      const filename = `human/${Date.now()}-${file.originalname}`;
      await humanSummaryBucket.file(filename).save(file.buffer);

      // Create database record
      await prisma.trainingAsset.create({
        data: {
          userId,
          type: "human_summary",
          filename,
          fileSize: file.size,
          description: `Human-written summary: ${file.originalname}`,
        },
      });

      res.json({ message: "Human summary uploaded", filename });
    } catch (err) {
      console.error("Upload human summary error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// Upload or generate aligned training pairs (.jsonl)
router.post(
  "/upload-training-pair",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;
      const userId = (req as any).user?.userId;
      if (!file || !userId) {
        res.status(400).json({ error: "Missing file or unauthorized" });
        return;
      }

      const filename = `pairs/${Date.now()}-${file.originalname}`;
      await pairBucket.file(filename).save(file.buffer);

      // Create database record
      await prisma.trainingAsset.create({
        data: {
          userId,
          type: "training_pair",
          filename,
          fileSize: file.size,
          description: `Training pair: ${file.originalname}`,
        },
      });

      res.json({ message: "Training pair uploaded", filename });
    } catch (err) {
      console.error("Upload training pair error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// Optional: Auto-generate training pairs JSONL from raw transcript + human summary
router.post(
  "/generate-pairs",
  authenticateToken,
  upload.fields([
    { name: "transcript", maxCount: 1 },
    { name: "summary", maxCount: 1 },
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const transcriptFile = (req.files as any)["transcript"][0];
      const summaryFile = (req.files as any)["summary"][0];
      const instructions = req.body.instructions || "";
      const userId = (req as any).user?.userId;

      if (!transcriptFile || !summaryFile || !userId) {
        res.status(400).json({ error: "Missing files or unauthorized" });
        return;
      }

      // Extract file content (as string) - handle PDF/DOC files
      const transcriptContent = await extractTextFromFile(
        transcriptFile.buffer,
        transcriptFile.originalname
      );
      const summaryContent = await extractTextFromFile(
        summaryFile.buffer,
        summaryFile.originalname
      );

      // Generate JSONL pair
      const pairJsonl =
        JSON.stringify({
          prompt: transcriptContent,
          completion: summaryContent,
          instructions,
        }) + "\n";

      const filename = `pairs/generated-${Date.now()}.jsonl`;
      await pairBucket.file(filename).save(Buffer.from(pairJsonl));

      await prisma.trainingAsset.create({
        data: {
          userId,
          type: "generated_pair",
          filename,
          fileSize: Buffer.byteLength(pairJsonl),
          description: instructions,
        },
      });

      res.json({ message: "Training pair generated", filename });
    } catch (err) {
      console.error("Generate pairs error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// Training session history
router.get(
  "/history",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.userId;
    const history = await prisma.trainingAsset.findMany({
      where: { userId },
      orderBy: { uploadedAt: "desc" },
    });

    res.json(history);
  }
);

export default router;

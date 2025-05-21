// src/routes/summaryJobRoutes.ts

import express, { Request, Response } from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import pdf from "pdf-parse";
import { Storage } from "@google-cloud/storage";

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files");

// Utility functions
function clean(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/\uFFFD/g, "");
}

function splitPages(txt: string): { page: number; text: string }[] {
  const byFF = txt.split(/\f/);
  if (byFF.length > 1) return byFF.map((t, i) => ({ page: i + 1, text: t }));

  let buf: string[] = [];
  const out: { page: number; text: string }[] = [];
  let current = 1;
  const flush = () => { if (buf.length) out.push({ page: current++, text: buf.join("\n") }); buf = []; };
  for (const line of txt.split("\n")) {
    if (/^\s*Page\s+\d+\s*$/i.test(line)) flush();
    buf.push(line);
  }
  flush();
  return out;
}

// --------- GET summary job status by ID ----------
router.get(
  "/:jobId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const job = await prisma.summaryJob.findUnique({ where: { id: req.params.jobId } });
      if (!job) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({
        status: job.status,
        lastPageProcessed: job.lastPageProcessed,
        totalPages: job.totalPages,
        summaryCsvUrl: job.summaryCsvUrl,
        error: job.error,
      });
    } catch (err) {
      console.error("Error fetching summary job:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// --------- POST new summary job (file upload) ----------
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;
      const userId = (req as any).user?.userId;
      if (!file || !userId) {
        res.status(400).json({ error: "missing file or auth" });
        return;
      }
      // Save PDF to GCS
      await depositionBucket.file(file.originalname).save(file.buffer);
      const fileUrl = `https://storage.googleapis.com/${depositionBucket.name}/${file.originalname}`;

      // Get page count (quick PDF parse)
      const parsed = await pdf(file.buffer);
      const transcript = clean(parsed.text);
      const pages = splitPages(transcript);

      // Create summary job in DB
      const job = await prisma.summaryJob.create({
        data: {
          userId,
          fileName: file.originalname,
          fileUrl,
          status: "processing",
          lastPageProcessed: 0,
          totalPages: pages.length,
        }
      });

      res.json({ jobId: job.id, totalPages: pages.length, status: "processing" });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

export default router;
// ─── src/routes/uploadRoutes.ts ────────────────────────────────────────────
import express, { Request, Response } from "express";
import multer from "multer";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import pdf from "pdf-parse";
import mammoth from "mammoth";                // ← NEW for Word docs
import path from "path";                      // ← to read file extension

const router        = express.Router();
const prisma        = new PrismaClient();
const upload        = multer({ storage: multer.memoryStorage() });
const storage       = new Storage();
const depositionBkt = storage.bucket("deposition-files");

/* ───────── helpers ───────── */
const clean = (s: string) =>
  s.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/\uFFFD/g, "");

function splitPages(txt: string) {
  // crude split: either FF chars or “Page \d+” markers
  const byFF = txt.split(/\f/);
  if (byFF.length > 1) return byFF.map((t, i) => ({ page: i + 1, text: t }));

  const out: { page: number; text: string }[] = [];
  let page = 1,
    buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push({ page: page++, text: buf.join("\n") });
    buf = [];
  };

  for (const line of txt.split("\n")) {
    if (/^\s*Page\s+\d+\s*$/i.test(line)) flush();
    buf.push(line);
  }
  flush();
  return out;
}

/* ───────── POST /api/upload ───────── */
router.post(
  "/",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const file   = req.file;
      const userId = (req as any).user?.userId;

      if (!file || !userId) {
        res.status(400).json({ error: "Missing file or authentication" });
        return;
      }

      /* 1️⃣  upload raw bytes to GCS  */
      await depositionBkt.file(file.originalname).save(file.buffer);
      const fileUrl = `https://storage.googleapis.com/${depositionBkt.name}/${file.originalname}`;

      /* 2️⃣  quick page‑count for status bar (PDF or DOCX)  */
      const ext = path.extname(file.originalname).toLowerCase();
      let totalPages = 1; // default

      if (ext === ".pdf") {
        const parsed = await pdf(file.buffer);
        totalPages   = splitPages(clean(parsed.text)).length;
      } else if (ext === ".doc" || ext === ".docx") {
        const { value } = await mammoth.extractRawText({ buffer: file.buffer });
        totalPages     = splitPages(value).length;
      }

      /* 3️⃣  create a processing job  */
      const job = await prisma.summaryJob.create({
        data: {
          userId,
          fileName: file.originalname,
          fileUrl,
          status: "processing",
          totalPages,
          lastPageProcessed: 0,
        },
      });

      res.json({ jobId: job.id, totalPages, status: "processing" });
    } catch (err: any) {
      console.error("Upload error:", err);
      res
        .status(400)                            // bad upload/parsing → 400
        .json({ error: err.message || "Upload failed" });
    }
  }
);

export default router;
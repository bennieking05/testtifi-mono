// ─── src/routes/uploadRoutes.ts ────────────────────────────────────────────────
import express, { Request, Response } from "express";
import Busboy, { FileInfo } from "busboy";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

/*──────────────────────── setup ────────────────────────*/
const router = express.Router();
const prisma = new PrismaClient();
const storage = new Storage();
const depositionBkt = storage.bucket("deposition-files");

/*──────────────────────── helpers ────────────────────────*/
/** Accept only PDF / DOC / DOCX for now */
const allowedMime = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Inserts a new summaryJob record and responds to the client.
 * We defer page‑count/OCR work to the worker so the upload route
 * stays lightweight and memory‑safe.
 */
async function createJobAndRespond(
  userId: string,
  fileName: string,
  res: Response
) {
  const fileUrl = `https://storage.googleapis.com/${
    depositionBkt.name
  }/${encodeURIComponent(fileName)}`;

  const job = await prisma.summaryJob.create({
    data: {
      userId,
      fileName,
      fileUrl,
      status: "processing",
      totalPages: 0,
      lastPageProcessed: 0,
    },
  });

  res.json({ jobId: job.id, status: "processing", totalPages: 0 });
}

/*──────────────────────── route ────────────────────────*/
router.post("/", authenticateToken, (req: Request, res: Response): void => {
  const userId = (req as any).user?.userId as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "Missing authentication" });
    return;
  }

  const bb = Busboy({
    headers: req.headers,
    highWaterMark: 2 * 1024 * 1024, // 2 MiB chunks → minimal RAM
  });

  let hasFile = false;
  let responded = false;

  bb.on(
    "file",
    (_fieldName: string, file: NodeJS.ReadableStream, info: FileInfo) => {
      hasFile = true;

      if (!allowedMime.has(info.mimeType)) {
        file.resume(); // discard stream
        if (!responded) {
          responded = true;
          res.status(400).json({ error: "Unsupported file type" });
        }
        return;
      }

      const gcsFile = depositionBkt.file(info.filename);
      const gcsStream = gcsFile.createWriteStream({
        resumable: false,
        contentType: info.mimeType,
        // ⚠️ no predefinedAcl here — bucket uses Uniform Bucket‑Level Access
      });

      file.pipe(gcsStream);

      gcsStream.on("error", (err) => {
        console.error("GCS upload error:", err);
        if (!responded) {
          responded = true;
          res.status(500).json({ error: "Upload failed" });
        }
      });

      gcsStream.on("finish", async () => {
        if (responded) return;
        responded = true;
        /* No makePrivate(): bucket has Uniform Bucket‑Level Access enabled */
        try {
          await createJobAndRespond(userId, info.filename, res);
        } catch (err) {
          console.error("DB insert error:", err);
          res.status(500).json({ error: "Internal error" });
        }
      });
    }
  );

  bb.on("close", () => {
    if (!hasFile && !responded) {
      res.status(400).json({ error: "Missing file" });
    }
  });

  req.pipe(bb);
});

export default router;

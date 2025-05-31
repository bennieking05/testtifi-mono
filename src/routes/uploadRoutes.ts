// ─── src/routes/uploadRoutes.ts ────────────────────────────────────────────────
import express, { Request, Response } from "express";
import busboy from "busboy";
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
const allowedMime = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Inserts a new summaryJob row and responds to the client.
 * Doing this *before* the later worker picks up the file keeps the
 * upload route lightweight (no PDF parsing → no OOM).
 */
async function createJobAndRespond(
  userId: string,
  fileName: string,
  res: Response
) {
  const fileUrl = `https://storage.googleapis.com/${depositionBkt.name}/${fileName}`;

  const job = await prisma.summaryJob.create({
    data: {
      userId,
      fileName,
      fileUrl,
      status: "processing",
      totalPages: 0, // let the worker fill this in after OCR/PDF parse
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

  try {
    const bb = busboy({
      headers: req.headers,
      highWaterMark: 2 * 1024 * 1024, // 2 MiB chunks → minimal RAM
    });

    let hasFile = false;
    let uploadFinished = false;

    bb.on("file", (_field, file, info) => {
      hasFile = true;

      if (!allowedMime.has(info.mimeType)) {
        file.resume(); // discard stream
        res.status(400).json({ error: "Unsupported file type" });
        return;
      }

      const gcsFile = depositionBkt.file(info.filename);
      const gcsStream = gcsFile.createWriteStream({
        resumable: false,
        contentType: info.mimeType,
      });

      file.pipe(gcsStream);

      gcsStream.on("error", (err) => {
        console.error("GCS upload error:", err);
        if (!uploadFinished) {
          uploadFinished = true;
          res.status(500).json({ error: "Upload failed" });
        }
      });

      gcsStream.on("finish", async () => {
        try {
          await gcsFile.makePrivate({ strict: false }); // optional: keep bucket private
          if (!uploadFinished) {
            uploadFinished = true;
            await createJobAndRespond(userId, info.filename, res);
          }
        } catch (err) {
          console.error("DB insert error:", err);
          if (!uploadFinished) {
            uploadFinished = true;
            res.status(500).json({ error: "Internal error" });
          }
        }
      });
    });

    bb.on("close", () => {
      if (!hasFile && !uploadFinished) {
        res.status(400).json({ error: "Missing file" });
      }
    });

    req.pipe(bb);
  } catch (err: any) {
    console.error("Upload route error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

export default router;

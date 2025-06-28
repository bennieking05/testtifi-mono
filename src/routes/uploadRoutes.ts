// ─── src/routes/uploadRoutes.ts ───────────────────────────────────────────────
import express, { Request, Response } from "express";
import Busboy, { FileInfo } from "busboy";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();
const storage = new Storage();
const depositionBkt = storage.bucket("deposition-files");

/*──────────────────────── helpers ────────────────────────*/
const allowedMime = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** wraps the DB work in a single transaction (create + credit-decrement) */
async function createJobTx(userId: string, fileName: string) {
  const fileUrl = `https://storage.googleapis.com/${
    depositionBkt.name
  }/${encodeURIComponent(fileName)}`;

  return prisma.$transaction(async (tx) => {
    // 1) deduct one credit – will throw if user has < 1
    await tx.user.update({
      where: { id: userId },
      data: { credits: { decrement: 1 } },
    });

    // 2) create the SummaryJob row
    return tx.summaryJob.create({
      data: {
        userId,
        fileName,
        fileUrl,
        status: "processing",
        totalPages: 0,
        lastPageProcessed: 0,
        notifyOnComplete: false,
      },
    });
  });
}

/*──────────────────────── route ────────────────────────*/
router.post(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    /* ---------- auth & credit check ---------- */
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "Missing authentication" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    if (user.credits < 1) {
      res.status(402).json({ error: "Not enough credits" });
      return;
    }

    /* ---------- streaming upload ---------- */
    const bb = Busboy({ headers: req.headers, highWaterMark: 2 * 1024 * 1024 });
    let hasFile = false;
    let replied = false;

    bb.on("file", (_field, file, info: FileInfo) => {
      hasFile = true;
      if (!allowedMime.has(info.mimeType)) {
        file.resume();
        if (!replied) {
          replied = true;
          res.status(400).json({ error: "Unsupported file type" });
        }
        return;
      }

      const gcsFile = depositionBkt.file(info.filename);
      const gcsStream = gcsFile.createWriteStream({
        resumable: false,
        contentType: info.mimeType,
      });
      file.pipe(gcsStream);

      gcsStream.on("error", (err) => {
        console.error("[GCS upload] ", err);
        if (!replied) {
          replied = true;
          res.status(500).json({ error: "Upload failed" });
        }
      });

      gcsStream.on("finish", async () => {
        if (replied) return;
        replied = true;
        try {
          const job = await createJobTx(userId, info.filename);
          res.json({ jobId: job.id, status: "processing", totalPages: 0 });
        } catch (err: any) {
          /* rollback already happened inside the transaction */
          const msg =
            err?.code === "P2000" || /credits/i.test(err?.message || "")
              ? "Not enough credits"
              : "Internal error";
          const code = /credits/i.test(msg) ? 402 : 500;
          res.status(code).json({ error: msg });
        }
      });
    });

    bb.on("close", () => {
      if (!hasFile && !replied) {
        res.status(400).json({ error: "Missing file" });
      }
    });

    req.pipe(bb);
  }
);

export default router;

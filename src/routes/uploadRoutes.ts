// src/routes/uploadRoutes.ts

import express, { Request, Response } from "express";
import Busboy, { FileInfo } from "busboy";
import { Storage } from "@google-cloud/storage";
import { Prisma, PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { randomUUID } from "crypto";

const router = express.Router();
const prisma = new PrismaClient();
const storage = new Storage();
const depositionBkt = storage.bucket("deposition-files");

const allowedMime = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** wraps the DB work in a single transaction (create File + create SummaryJob + credit‐decrement) */
async function createJobTx(
  userId: string,
  fileName: string,
  summaryName: string,
  deponent: string,
  notifyOnComplete: boolean
) {
  const fileId = randomUUID();
  const fileUrl = `https://storage.googleapis.com/${
    depositionBkt.name
  }/${encodeURIComponent(fileName)}`;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1) deduct one credit
    await tx.user.update({
      where: { id: userId },
      data: { credits: { decrement: 1 } },
    });

    // 2) create file record
    const file = await tx.file.create({
      data: {
        id: fileId,
        userId,
        fileName,
        fileUrl,
        summaryFileName: null,
        summaryUrl: null,
        pages: 0,
        deponent: deponent || null,
        title: summaryName || fileName,
      },
    });

    // 3) create summary job
    const job = await tx.summaryJob.create({
      data: {
        userId,
        fileName,
        fileUrl,
        fileId: file.id,
        status: "queued",
        totalPages: 0,
        lastPageProcessed: 0,
        notifyOnComplete,
      },
    });

    return job;
  });
}
router.post(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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

    // make sure they have at least one credit to spend
    if (user.credits < 1) {
      res.status(402).json({ error: "Not enough credits" });
      return;
    }

    const bb = Busboy({
      headers: req.headers,
      highWaterMark: 2 * 1024 * 1024,
    });

    let hasFile = false;
    let replied = false;
    let summaryName = "";
    let deponent = "";
    let notifyOnComplete = false;

    bb.on("field", (fieldname, val) => {
      if (fieldname === "summaryName") summaryName = val;
      if (fieldname === "deponent") deponent = val;
      if (fieldname === "notifyOnComplete") notifyOnComplete = val === "true";
    });

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
        console.error("[GCS upload]", err);
        if (!replied) {
          replied = true;
          res.status(500).json({ error: "Upload failed" });
        }
      });

      gcsStream.on("finish", async () => {
        if (replied) return;
        replied = true;

        try {
          const job = await createJobTx(
            userId,
            info.filename,
            summaryName,
            deponent,
            notifyOnComplete
          );
          res.json({ jobId: job.id, status: "processing", totalPages: 0 });
        } catch (err: any) {
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

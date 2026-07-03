// src/routes/uploadRoutes.ts

import express, { Request, Response } from "express";
import Busboy, { FileInfo } from "busboy";
import { Storage } from "@google-cloud/storage";
import { Prisma, PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { randomUUID } from "crypto";
import { debitCreditsForSummary, refundCreditsForSummary } from "./billingRoutes";
import { InsufficientCreditsError } from "../billing/fifoAllocator";
import { getEffectiveCreditBalance } from "../billing/creditExpiration";
import path from "path";

const router = express.Router();
const prisma = new PrismaClient();
const storage = new Storage();
const depositionBkt = storage.bucket("deposition-files");

const allowedMime = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Wraps the DB work in a single transaction (create File + create SummaryJob) with specified job ID */
async function createJobTxWithId(
  jobId: string,
  userId: string,
  originalFileName: string,
  fileUrl: string,
  summaryName: string,
  deponent: string,
  notifyOnComplete: boolean
) {
  const fileId = randomUUID();

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1) create file record
    const file = await tx.file.create({
      data: {
        id: fileId,
        userId,
        fileName: originalFileName,
        fileUrl,
        summaryFileName: null,
        summaryUrl: null,
        pages: 0,
        deponent: deponent || null,
        title: summaryName || originalFileName,
      },
    });

    // 2) create summary job with the specified ID
    const job = await tx.summaryJob.create({
      data: {
        id: jobId,
        userId,
        fileName: originalFileName,
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

function gcsPublicUrl(bucketName: string, objectName: string): string {
  // Encode per path segment (so slashes remain slashes).
  const encoded = objectName
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://storage.googleapis.com/${bucketName}/${encoded}`;
}

function safeBaseName(name: string): string {
  const base = path.basename(name || "upload");
  return base.replace(/[^\w.\- ()]+/g, "_");
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

    // Reserve credits BEFORE accepting the file upload (prevents race condition)
    // Generate a reservation ID that will become the summary ID after job creation
    const reservationId = randomUUID();
    let creditsReserved = false;
    
    try {
      const effectiveBalance = await getEffectiveCreditBalance(prisma, userId);
      if (effectiveBalance < 1) {
        res
          .status(402)
          .json({
            error:
              "Insufficient credits. Please purchase more credits to create a summary.",
          });
        return;
      }
      
      // Debit credits upfront with a reservation key
      await debitCreditsForSummary(userId, reservationId, `Reserved for upload`);
      creditsReserved = true;
    } catch (debitError: any) {
      if (debitError instanceof InsufficientCreditsError) {
        res.status(402).json({
          error: "Insufficient credits. Please purchase more credits to create a summary.",
          required: debitError.required,
          available: debitError.available,
        });
        return;
      }
      console.error("Error reserving credits:", debitError);
      res.status(500).json({ error: "Failed to reserve credits" });
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

    // Helper to refund credits if upload fails
    const refundReservedCredits = async () => {
      if (creditsReserved) {
        try {
          await refundCreditsForSummary(userId, reservationId);
          console.log(`[Upload] Refunded reserved credit for failed upload (reservation: ${reservationId})`);
        } catch (refundError: any) {
          console.error(`[Upload] Failed to refund reserved credit:`, refundError?.message || refundError);
        }
        creditsReserved = false;
      }
    };

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
          refundReservedCredits();
          res.status(400).json({ error: "Unsupported file type" });
        }
        return;
      }

      // IMPORTANT: Never use the raw filename as the GCS object key.
      // Different users uploading "UAT Tester 22.pdf" would overwrite each other.
      const originalFileName = safeBaseName(info.filename);
      const objectKey = `${userId}/${randomUUID()}-${originalFileName}`;
      const gcsFile = depositionBkt.file(objectKey);
      const gcsStream = gcsFile.createWriteStream({
        resumable: false,
        contentType: info.mimeType,
      });

      file.pipe(gcsStream);

      gcsStream.on("error", async (err) => {
        console.error("[GCS upload]", err);
        if (!replied) {
          replied = true;
          await refundReservedCredits();
          res.status(500).json({ error: "Upload failed" });
        }
      });

      gcsStream.on("finish", async () => {
        if (replied) return;
        replied = true;

        try {
          const fileUrl = gcsPublicUrl(depositionBkt.name, objectKey);
          
          // Create job with the same ID we used for credit reservation
          const job = await createJobTxWithId(
            reservationId,
            userId,
            originalFileName,
            fileUrl,
            summaryName,
            deponent,
            notifyOnComplete
          );
          
          // Update the ledger entry description to include the actual summary name
          try {
            await prisma.ledgerEntry.updateMany({
              where: { idempotencyKey: `summary:${reservationId}` },
              data: { description: summaryName || originalFileName },
            });
          } catch {
            // Ignore if ledger entry update fails (might be using legacy credits)
          }
          
          res.json({ jobId: job.id, status: "processing", totalPages: 0 });
        } catch (err: any) {
          console.error("Upload error:", err);
          await refundReservedCredits();
          res.status(500).json({ error: "Internal error" });
        }
      });
    });

    bb.on("close", async () => {
      if (!hasFile && !replied) {
        await refundReservedCredits();
        res.status(400).json({ error: "Missing file" });
      }
    });

    req.pipe(bb);
  }
);

export default router;

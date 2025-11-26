// src/routes/emailNotificationRoutes.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import { authenticateToken } from "../middlewares/authMiddleware";
import { parseMarkdown } from "./downloadRoutes";
import { sendSummaryReadyEmail } from "../utils/summaryEmail";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");

// Note: Duplicate prevention now uses database field completionEmailSentAt instead of in-memory cache

// Frontend URL with robust fallbacks for staging/production
const frontendUrl = (() => {
  const raw =
    process.env.BASE_URL ??
    process.env.FRONTEND_URL ??
    process.env.APP_URL;
  const isBad =
    !raw ||
    /^\s*$/.test(String(raw)) ||
    /^(undefined|null)$/i.test(String(raw).trim());
  const explicit = isBad ? undefined : String(raw).trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const isStaging = process.env.STAGING === "1" || process.env.ENVIRONMENT === "staging";
  if (isStaging) return "https://staging.app.testifi.ai";
  if (process.env.NODE_ENV === "production") return "https://app.testifi.ai";
  return "http://localhost:3000";
})();

// Helper to extract object name from GCS URL
function objectKey(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.slice(1));
  } catch {
    return url;
  }
}

/**
 * POST /api/email-notifications
 * Body: { summaryId: string; notifyOnComplete: boolean }
 * Sets (or clears) the notify-on-complete flag for the caller's summary job.
 * If the job is already complete and the user is opting in, sends email immediately.
 */
router.post(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const { summaryId, notifyOnComplete } = req.body as {
      summaryId?: string;
      notifyOnComplete?: unknown;
    };

    if (!summaryId || typeof notifyOnComplete === "undefined") {
      res
        .status(400)
        .json({ error: "summaryId and notifyOnComplete are required" });
      return;
    }

    const userId = (req as any).user?.userId as string;

    try {
      // 1. Update the notifyOnComplete flag
      const updateResult = await prisma.summaryJob.updateMany({
        where: { id: summaryId, userId },
        data: { notifyOnComplete: Boolean(notifyOnComplete) },
      });

      if (updateResult.count === 0) {
        res.status(404).json({ error: "Summary job not found" });
        return;
      }

      // 2. If opting in and job is already complete, send email now
      if (notifyOnComplete) {
        // re-fetch the job to see its status and userId
        const job = await prisma.summaryJob.findUnique({
          where: { id: summaryId },
          include: { file: true },
        });

        if (job?.status === "complete") {
          // fetch the user record
          const user = await prisma.user.findUnique({
            where: { id: job.userId },
          });

          if (user?.email) {
            // Atomically check and mark email as sent to prevent duplicates across processes
            // Only update if completionEmailSentAt is null (hasn't been sent yet)
            const emailUpdateResult = await prisma.summaryJob.updateMany({
              where: { 
                id: job.id,
                completionEmailSentAt: null, // Only update if email hasn't been sent
              },
              data: { completionEmailSentAt: new Date() },
            });
            
            if (emailUpdateResult.count === 0) {
              console.log(`[email-notification] Email already sent for summary job ${job.id}, skipping`);
              res.json({ ok: true });
              return;
            }

            const dashboardUrl = `${frontendUrl}/summaries`;
            const displayTitle = job.file?.title || job.fileName?.replace(/\.[^.]+$/, "") || `Summary ${job.id}`;

            // Generate document attachments
            try {
              console.log(`[${job.id}] 📄 Generating DOCX and PDF attachments for immediate notification...`);
              
              // Retrieve summary markdown from GCS
              const key = job.summaryCsvUrl
                ? objectKey(job.summaryCsvUrl)
                : job.file?.summaryFileName ?? `summary-${job.id}.md`;
              
              const [buf] = await bucket.file(key).download();
              const summaryContent = buf.toString("utf-8");
              const { meta, rows } = parseMarkdown(summaryContent);
              
              // Convert job to match JobData interface (pages needs to be string)
              const jobData = {
                id: job.id,
                fileName: job.fileName,
                createdAt: job.createdAt,
                file: job.file ? {
                  title: job.file.title,
                  deponent: job.file.deponent,
                  pages: job.file.pages !== null ? String(job.file.pages) : null,
                } : null,
              };
              
              const emailResult = await sendSummaryReadyEmail({
                jobId: job.id,
                userEmail: user.email,
                userName: user.name || user.email,
                displayTitle,
                dashboardUrl,
                jobData,
                documentData: { meta, rows },
                summaryContent,
              });
              console.log(
                `Immediate notification sent for job ${job.id}${
                  emailResult.attachmentCount ? ` with ${emailResult.attachmentCount} attachment(s)` : ""
                }`
              );
            } catch (emailErr) {
              console.error(
                `Failed to send immediate email for job ${job.id}:`,
                emailErr
              );
              // If email fails, reset the completionEmailSentAt so it can be retried
              await prisma.summaryJob.updateMany({
                where: { id: job.id },
                data: { completionEmailSentAt: null },
              });
            }
          }
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[emailNotification] update error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

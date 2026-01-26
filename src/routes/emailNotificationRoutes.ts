// src/routes/emailNotificationRoutes.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import { authenticateToken } from "../middlewares/authMiddleware";
import { sendEmail, EmailAttachment } from "../lib/sendEmail";
import { parseMarkdown } from "./downloadRoutes";
import { generateDocxBuffer, generatePdfBuffer } from "../utils/generateDocuments";
import { getLightLogoDataUri } from "../utils/logo";
import {
  resolveSummaryMetadata,
  renderMetadataMarkdown,
} from "../utils/summaryMetadata";
import { resolveFrontendBaseUrl } from "../utils/frontendUrl";
import {
  claimCompletionEmailSend,
  releaseCompletionEmailSend,
} from "../utils/emailDeliveryGuard";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");

// Frontend URL with fallback (same pattern as authController)
const frontendUrl = resolveFrontendBaseUrl();

// Helper to extract object name from GCS URL
function objectKey(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.slice(1));
  } catch {
    return url;
  }
}

function extractAllPages(label: string): number[] {
  const out: number[] = [];
  const re = /(?:^|[,\s|])(?:p(?:age)?\.?)?\s*(\d{1,6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label))) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function enforcePageBounds(
  rows: Array<[string, string, string]>,
  opts: { maxPage?: number } = {}
): Array<[string, string, string]> {
  const maxPage = opts.maxPage && opts.maxPage > 0 ? opts.maxPage : null;
  if (!maxPage) return rows;
  const kept: Array<[string, string, string]> = [];
  let sawValid = false;
  let invalidStreak = 0;
  for (const row of rows) {
    const pages = extractAllPages(row[0]);
    if (!pages.length) {
      kept.push(row);
      continue;
    }
    const invalid = pages.some((p) => p < 1 || p > maxPage);
    if (invalid) {
      if (!sawValid) continue; // drop leading p.0 etc
      invalidStreak++;
      if (invalidStreak >= 10) break; // truncate hallucinated tail
      continue;
    }
    sawValid = true;
    invalidStreak = 0;
    kept.push(row);
  }
  return kept;
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

          let emailSent = false;
          if (user?.email) {
            const claimed = await claimCompletionEmailSend(prisma, job.id);
            if (!claimed) {
              console.log(
                `[email-notification] Completion email already sent for summary job ${job.id}, skipping`
              );
            } else {
              const dashboardUrl = `${frontendUrl}/summaries`;
              const logoDataUri = getLightLogoDataUri();

              // Get display title for email
              const displayTitle =
                job.file?.title ||
                job.fileName?.replace(/\.[^.]+$/, "") ||
                `Summary ${job.id}`;

              // Generate document attachments
              const attachments: EmailAttachment[] = [];
              try {
                console.log(
                  `[${job.id}] 📄 Generating DOCX and PDF attachments for immediate notification...`
                );

                // Retrieve summary markdown from GCS
                const key = job.summaryCsvUrl
                  ? objectKey(job.summaryCsvUrl)
                  : job.file?.summaryFileName ?? `summary-${job.id}.md`;

                const [buf] = await bucket.file(key).download();
                const summaryContent = buf.toString("utf-8");
                const { rows } = parseMarkdown(summaryContent);
                const metadata = await resolveSummaryMetadata(bucket, job as any);
                const metadataLines = renderMetadataMarkdown(metadata).split("\n");
                const maxPage =
                  (metadata.totalPages && metadata.totalPages > 0
                    ? metadata.totalPages
                    : job.file?.pages != null
                    ? Number(job.file.pages)
                    : undefined) || undefined;
                const boundedRows = enforcePageBounds(rows, { maxPage });

                // Convert job to match JobData interface (pages needs to be string)
                const jobData = {
                  id: job.id,
                  fileName: job.fileName,
                  createdAt: job.createdAt,
                  file: job.file
                    ? {
                        title: job.file.title,
                        deponent: job.file.deponent,
                        pages:
                          job.file.pages !== null
                            ? String(job.file.pages)
                            : null,
                      }
                    : null,
                };

                // Generate DOCX
                const docxBuffer = await generateDocxBuffer(
                  jobData,
                  metadata,
                  { meta: metadataLines, rows: boundedRows },
                  summaryContent
                );
                const docxFilename = `${
                  displayTitle
                    .replace(/[^a-z0-9_.-]+/gi, "-")
                    .replace(/-+/g, "-")
                    .replace(/^-|-$/g, "") || "summary"
                }.docx`;
                attachments.push({
                  content: docxBuffer.toString("base64"),
                  filename: docxFilename,
                  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                });

                // Generate PDF
                const pdfBuffer = await generatePdfBuffer(
                  jobData,
                  metadata,
                  { meta: metadataLines, rows: boundedRows },
                  summaryContent
                );
                const pdfFilename = `${
                  displayTitle
                    .replace(/[^a-z0-9_.-]+/gi, "-")
                    .replace(/-+/g, "-")
                    .replace(/^-|-$/g, "") || "summary"
                }.pdf`;
                attachments.push({
                  content: pdfBuffer.toString("base64"),
                  filename: pdfFilename,
                  type: "application/pdf",
                });

                console.log(
                  `[${job.id}] ✅ Generated ${attachments.length} document attachments`
                );
              } catch (docErr) {
                console.warn(
                  `[${job.id}] ⚠️ Failed to generate document attachments:`,
                  docErr
                );
                // Continue sending email without attachments if document generation fails
              }

              const subject = `Your Deposition Summary Is Ready`;
              const userName = user.name || user.email;

              const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deposition Summary Ready</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .wrapper {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background-color: #5674BC;
      padding: 24px 16px;
      text-align: center;
    }
    .header img {
      max-width: 200px;
      height: auto;
    }
    .content {
      padding: 32px 24px;
    }
    .content h2 {
      color: #333;
      margin-top: 0;
      margin-bottom: 20px;
      font-size: 24px;
    }
    .content p {
      margin: 16px 0;
      color: #555;
    }
    .cta-wrap {
      text-align: center;
      margin: 28px 0;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background-color: #5674BC;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
    }
    .btn:hover {
      background-color: #4563a3;
      color: #ffffff !important;
    }
    .retention-notice {
      margin-top: 24px;
      padding: 16px;
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
    }
    .retention-notice p {
      margin: 0;
      color: #856404;
    }
    .retention-notice p:first-child {
      font-weight: bold;
      margin-bottom: 8px;
    }
    .footer {
      background-color: #f7f7f7;
      color: #888;
      font-size: 13px;
      text-align: center;
      padding: 24px 16px;
      border-top: 1px solid #e0e0e0;
    }
    .footer p {
      margin: 4px 0;
    }
    @media (max-width: 600px) {
      .wrapper {
        border-radius: 0;
      }
      .content {
        padding: 24px 16px;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <img src="${logoDataUri}" alt="Testifi-AI" style="display: block; margin: 0 auto;" />
    </div>
    <div class="content">
      <h2>Your Deposition Summary Is Ready</h2>
      <p>Hello ${userName},</p>
      <p>Great news — the summary you requested for <strong>${displayTitle}</strong> is now complete. Click the button below to return to your dashboard and review it for the next 3 days. The summary will be automatically deleted after 3 days.</p>
      <div class="cta-wrap">
        <a href="${dashboardUrl}" class="btn">View on Dashboard</a>
      </div>
      ${attachments.length > 0 ? `<p style="text-align: center; color: #666; font-size: 14px;">Your summary is attached to this email in Word (DOCX) and PDF formats.</p>` : ""}
      <div class="retention-notice">
        <p><strong>Important:</strong> Summary Retention Policy</p>
        <p>Summaries older than 3 days will be automatically deleted from the platform and the content will be irretrievable.\
      <p>Need help or have questions? Reply to this email and our support team will be happy to assist.</p>
    </div>
    <div class="footer">
      <p><strong>© 2025 Testifi-AI. All rights reserved.</strong></p>
      <p>You're receiving this because you have an account on Testifi-AI.</p>
    </div>
  </div>
</body>
</html>`;
              try {
                await sendEmail(
                  user.email,
                  subject,
                  undefined,
                  html,
                  attachments,
                  { disableTextFallback: true }
                );
                emailSent = true;
                console.log(
                  `Immediate notification sent for job ${job.id}${
                    attachments.length > 0
                      ? ` with ${attachments.length} attachment(s)`
                      : ""
                  }`
                );
              } catch (emailErr) {
                await releaseCompletionEmailSend(prisma, job.id);
                console.error(
                  `Failed to send immediate email for job ${job.id}:`,
                  emailErr
                );
                res
                  .status(500)
                  .json({ error: "Failed to send completion email" });
                return;
              }
            }
          }
          res.json({ ok: true, emailSent });
          return;
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

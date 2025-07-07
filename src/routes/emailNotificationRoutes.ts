// src/routes/emailNotificationRoutes.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { sendEmail } from "../lib/sendEmail"; // adjust path as needed

const router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /api/email-notifications
 * Body: { summaryId: string; notifyOnComplete: boolean }
 * Sets (or clears) the notify-on-complete flag for the caller’s summary job.
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
        });

        if (job?.status === "complete") {
          // fetch the user record
          const user = await prisma.user.findUnique({
            where: { id: job.userId },
          });

          if (user?.email) {
            const downloadUrl = `${process.env.BASE_URL}/download/${job.id}`;
            const subject = `Your deposition summary is ready`;
            const text =
              `Hello ${user.name || user.email},\n\n` +
              `Your deposition summary "${job.id}" is now ready. ` +
              `Download it here: ${downloadUrl}\n\nThank you!`;
            const html = `
              <p>Hello ${user.name || user.email},</p>
              <p>Your deposition summary "<strong>${
                job.id
              }</strong>" is now ready.</p>
              <p><a href="${downloadUrl}">Click here to download</a></p>
            `;

            try {
              await sendEmail(user.email, subject, text, html);
              console.log(`Immediate notification sent for job ${job.id}`);
            } catch (emailErr) {
              console.error(
                `Failed to send immediate email for job ${job.id}:`,
                emailErr
              );
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

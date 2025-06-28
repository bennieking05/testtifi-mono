// ─── src/routes/emailNotificationRoutes.ts ─────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /api/email-notifications
 * Body: { summaryId: string; notifyOnComplete: boolean }
 * Sets (or clears) the notify-on-complete flag for the caller’s summary job.
 */
router.post(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    /*───────────────── input validation ─────────────────*/
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

    /*───────────────── DB update ─────────────────────────*/
    try {
      const result = await prisma.summaryJob.updateMany({
        where: { id: summaryId, userId },
        data: { notifyOnComplete: Boolean(notifyOnComplete) },
      });

      if (result.count === 0) {
        res.status(404).json({ error: "Summary job not found" });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[emailNotification] update error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

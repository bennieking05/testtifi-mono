// src/routes/summaries.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

// Returns all summary jobs for this user
router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const jobs = await prisma.summaryJob.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      // Adapt payload to match old /api/summaries for frontend compatibility:
      // id, title, summaryUrl, date, pages, status
      const summaries = jobs.map(job => ({
        id: job.id,
        title: job.fileName, // or job.title if you use that
        summaryUrl: job.summaryCsvUrl || undefined,
        date: job.createdAt.toISOString(),
        pages: job.totalPages,
        status:
          job.status === "complete"
            ? "active"
            : job.status === "error"
            ? "error"
            : "processing",
        error: job.error || undefined,
        progress: `${job.lastPageProcessed}/${job.totalPages}`,
      }));

      res.json(summaries);
    } catch (err) {
      console.error("[/api/summaries] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
// src/routes/summaries.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

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

      // Fetch all jobs for this user, including the File relation if fileId exists
      const jobs = await prisma.summaryJob.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { file: true },
      });

      // For jobs with no file relation (missing fileId), fallback by fileName
      const fallbackFileNames = jobs
        .filter(j => !j.file)
        .map(j => j.fileName);

      let fileNameLookup: Record<string, any> = {};
      if (fallbackFileNames.length > 0) {
        const files = await prisma.file.findMany({
          where: { fileName: { in: fallbackFileNames } },
        });
        fileNameLookup = Object.fromEntries(
          files.map(f => [f.fileName, f])
        );
      }

      const summaries = jobs.map(job => {
        // Priority: joined file → fallback file by fileName → fallback to fileName as last resort
        const file = job.file || fileNameLookup[job.fileName];

        return {
          id: job.id,
          title: file?.title || "Untitled Document",
          fileName: file?.fileName || job.fileName || "",
          summaryUrl: job.summaryCsvUrl || undefined,
          date: job.createdAt.toISOString(),
          pages: file?.pages ?? job.totalPages,
          status:
            job.status === "complete"
              ? "active"
              : job.status === "error"
              ? "error"
              : "processing",
          error: job.error || undefined,
          progress: `${job.lastPageProcessed}/${job.totalPages}`,
        };
      });

      res.json(summaries);
    } catch (err) {
      console.error("[/api/summaries] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
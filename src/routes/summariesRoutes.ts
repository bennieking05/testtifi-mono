// src/routes/summariesRoutes.ts
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();
const WORDS_PER_PAGE = 300;

router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId as string | undefined;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // 1️⃣ Fetch jobs + file relation
      const jobs = await prisma.summaryJob.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { file: true },
      });

      // 2️⃣ Fallback lookup for missing file relations
      const missingNames = jobs.filter((j) => !j.file).map((j) => j.fileName);
      let fileLookup: Record<string, any> = {};
      if (missingNames.length) {
        const files = await prisma.file.findMany({
          where: { fileName: { in: missingNames } },
        });
        fileLookup = Object.fromEntries(files.map((f) => [f.fileName, f]));
      }

      // 3️⃣ Build API response, recalculating pages via word‐count if needed
      const summaries = await Promise.all(
        jobs.map(async (job) => {
          const file = job.file ?? fileLookup[job.fileName];
          let pages = file?.pages ?? job.totalPages ?? 0;

          if (job.summaryCsvUrl) {
            try {
              const summaryRes = await axios.get<string>(job.summaryCsvUrl);
              const wordCount = summaryRes.data.trim().split(/\s+/).length;
              pages = Math.ceil(wordCount / WORDS_PER_PAGE);
            } catch (e) {
              console.warn("Failed to fetch/parse summary text:", e);
            }
          }

          return {
            id: job.id,
            title: file?.title || "Untitled Document",
            fileName: file?.fileName || job.fileName,
            summaryUrl: job.summaryCsvUrl || undefined,
            date: job.createdAt.toISOString(),
            pages,
            status:
              job.status === "complete"
                ? "active"
                : job.status === "error"
                ? "error"
                : "processing",
            error: job.error || undefined,
            progress: `${job.lastPageProcessed}/${job.totalPages}`,
          };
        })
      );

      res.json(summaries);
    } catch (err) {
      console.error("[/api/summaries] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

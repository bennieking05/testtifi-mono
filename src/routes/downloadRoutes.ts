// src/routes/summaryJobDownloadRoutes.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";

const router = express.Router();
const prisma = new PrismaClient();
const summaryBucket = new Storage().bucket("deposition-summaries");

router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const { jobId, format } = req.query as { jobId?: string; format?: string };

    if (!jobId || !format) {
      res.status(400).json({ error: "Missing jobId or format" });
      return;
    }

    const job = await prisma.summaryJob.findUnique({
      where: { id: jobId },
    });

    if (!job || !job.summaryCsvUrl) {
      res.status(404).json({ error: "Summary job not found or CSV not available" });
      return;
    }

    // Download the CSV summary from GCS
    try {
      // Extract the filename from the URL
      const fileName = job.summaryCsvUrl.split("/").pop();
      if (!fileName) throw new Error("Invalid summaryCsvUrl");
      const [csvBuffer] = await summaryBucket.file(fileName).download();

      // Currently, only CSV download is supported
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="summary-${jobId}.csv"`);
        res.send(csvBuffer);
        return;
      }

      // Optionally, you can add PDF, DOCX, TXT conversions here
      res.status(400).json({ error: "Only CSV download is supported right now." });
    } catch (err: any) {
      console.error("Download error:", err);
      res.status(500).json({ error: "Failed to retrieve summary content." });
    }
  }
);

export default router;
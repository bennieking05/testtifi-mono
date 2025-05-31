import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import axios from "axios";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();
const summaryBucket = new Storage().bucket("deposition-summaries");
const WORDS_PER_PAGE = 300;

/* fresh read helper */
async function fetchSummaryText(objectName: string): Promise<string> {
  const [url] = await summaryBucket
    .file(objectName)
    .getSignedUrl({ action: "read", expires: Date.now() + 3 * 86400_000 });
  const { data } = await axios.get<string>(url);
  return data;
}

router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    /* 1️⃣ jobs */
    const jobs = await prisma.summaryJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { file: true },
    });

    /* 2️⃣ orphaned files */
    const orphanNames = jobs.filter((j) => !j.file).map((j) => j.fileName);
    const extraFiles = orphanNames.length
      ? await prisma.file.findMany({ where: { fileName: { in: orphanNames } } })
      : [];
    const fileByName = Object.fromEntries(
      extraFiles.map((f) => [f.fileName, f])
    );

    /* 3️⃣ build response */
    const summaries = await Promise.all(
      jobs.map(async (job) => {
        const file = job.file ?? fileByName[job.fileName];
        const obj =
          job.summaryCsvUrl?.split("/").pop() ||
          file?.summaryFileName ||
          `summary-${job.id}.md`;

        let pages = file?.pages ?? job.totalPages ?? 0;
        if (obj) {
          try {
            const txt = await fetchSummaryText(obj);
            pages = Math.ceil(txt.trim().split(/\s+/).length / WORDS_PER_PAGE);
          } catch (e) {
            console.warn("fetchSummaryText failed:", (e as any).message);
          }
        }

        /* signed URL for front‑end (3 days) */
        const signedUrl = obj
          ? (
              await summaryBucket
                .file(obj)
                .getSignedUrl({
                  action: "read",
                  expires: Date.now() + 3 * 86400_000,
                })
            )[0]
          : undefined;

        return {
          id: job.id,
          title: file?.title || "Untitled Document",
          fileName: file?.fileName || job.fileName,
          summaryUrl: signedUrl,
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
    return;
  } catch (err) {
    console.error("[/api/summaries] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

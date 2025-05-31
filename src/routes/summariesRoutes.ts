import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import axios from "axios";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();
const summaryBucket = new Storage().bucket("deposition-summaries");
const WORDS_PER_PAGE = 300;

/**
 * Return the raw markdown text for an object in GCS – only if it exists.
 * Throws 404 if the object is missing, so callers _must_ guard with exists().
 */
async function fetchSummaryText(objectName: string): Promise<string> {
  const [signed] = await summaryBucket
    .file(objectName)
    .getSignedUrl({ action: "read", expires: Date.now() + 3 * 86400_000 });
  const { data } = await axios.get<string>(signed);
  return data;
}

router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    /* 1️⃣ summary jobs with eager file */
    const jobs = await prisma.summaryJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { file: true },
    });

    /* 2️⃣ orphaned files (by name) */
    const orphanNames = jobs.filter((j) => !j.file).map((j) => j.fileName);
    const extraFiles = orphanNames.length
      ? await prisma.file.findMany({ where: { fileName: { in: orphanNames } } })
      : [];
    const fileByName = Object.fromEntries(
      extraFiles.map((f) => [f.fileName, f])
    );

    /* 3️⃣ build API payload */
    const summaries = await Promise.all(
      jobs.map(async (job) => {
        const file = job.file ?? fileByName[job.fileName];
        const objectName =
          job.summaryCsvUrl?.split("/").pop() ||
          file?.summaryFileName ||
          `summary-${job.id}.md`;

        /* compute pages – only when job complete _and_ object exists */
        let pages = file?.pages ?? job.totalPages ?? 0;
        if (job.status === "complete" && objectName) {
          try {
            const [exists] = await summaryBucket.file(objectName).exists();
            if (exists) {
              const txt = await fetchSummaryText(objectName);
              pages = Math.ceil(
                txt.trim().split(/\s+/).length / WORDS_PER_PAGE
              );
            }
          } catch (e: any) {
            // If the object disappeared we silently ignore; no noisy logs
            if (e.response?.status !== 404) {
              console.warn("fetchSummaryText failed:", e.message);
            }
          }
        }

        /* signed URL for UI (3‑day) – only if object exists */
        let signedUrl: string | undefined;
        if (objectName) {
          try {
            const [exists] = await summaryBucket.file(objectName).exists();
            if (exists) {
              [signedUrl] = await summaryBucket.file(objectName).getSignedUrl({
                action: "read",
                expires: Date.now() + 3 * 86400_000,
              });
            }
          } catch {
            /* noop */
          }
        }

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
  } catch (err) {
    console.error("[/api/summaries] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

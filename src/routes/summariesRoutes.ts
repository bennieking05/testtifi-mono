// ─── src/routes/summariesRoutes.ts ───────────────────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");
const WORDS_PER_PAGE = 300;

const toObjectName = (u: string) => {
  try {
    const { pathname } = new URL(u);
    return pathname.substring(pathname.lastIndexOf("/") + 1);
  } catch {
    return u;
  }
};

/* helper that always pulls fresh text */
async function fetchSummaryText(objectName: string) {
  const [url] = await bucket.file(objectName).getSignedUrl({
    action: "read",
    expires: Date.now() + 3 * 86_400_000,
  });
  const { data } = await axios.get<string>(url);
  return data;
}

router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    /* jobs + inline file join */
    const jobs = await prisma.summaryJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { file: true },
    });

    /* any jobs whose File relation is missing */
    const orphanNames = jobs.filter((j) => !j.file).map((j) => j.fileName);
    const extraFiles = orphanNames.length
      ? await prisma.file.findMany({ where: { fileName: { in: orphanNames } } })
      : [];
    const fileByName = Object.fromEntries(
      extraFiles.map((f) => [f.fileName, f])
    );

    const summaries = await Promise.all(
      jobs.map(async (job) => {
        const file = job.file ?? fileByName[job.fileName];

        const objectName = job.summaryCsvUrl
          ? toObjectName(job.summaryCsvUrl)
          : file?.summaryFileName ?? `summary-${job.id}.md`;

        /* try to estimate pages via live word‑count */
        let pages = file?.pages ?? job.totalPages ?? 0;
        try {
          const txt = await fetchSummaryText(objectName);
          pages = Math.ceil(txt.trim().split(/\s+/).length / WORDS_PER_PAGE);
        } catch (e) {
          // benign – keep old page estimate
          console.warn("fetchSummaryText failed:", (e as any).message);
        }

        /* give UI a 3‑day signed URL */
        const signedUrl = (
          await bucket.file(objectName).getSignedUrl({
            action: "read",
            expires: Date.now() + 3 * 86_400_000,
          })
        )[0];

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

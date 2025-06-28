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

/* ───────── helpers ───────── */
const toObjectName = (u: string): string => {
  try {
    const { pathname } = new URL(u);
    return pathname.substring(pathname.lastIndexOf("/") + 1);
  } catch {
    return u;
  }
};

async function fetchSummaryText(objectName: string): Promise<string> {
  const [url] = await bucket.file(objectName).getSignedUrl({
    action: "read",
    expires: Date.now() + 3 * 86_400_000, // 3 days
  });
  const { data } = await axios.get<string>(url);
  return data;
}

/* ───────── LIST all summaries ───────── */
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

      /* 1️⃣ jobs + inline file join */
      const jobs = await prisma.summaryJob.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { file: true },
      });

      /* 2️⃣ orphan-file lookup */
      const orphanNames = jobs.filter((j) => !j.file).map((j) => j.fileName);
      const extraFiles = orphanNames.length
        ? await prisma.file.findMany({
            where: { fileName: { in: orphanNames } },
          })
        : [];
      const fileByName = Object.fromEntries(
        extraFiles.map((f) => [f.fileName, f])
      );

      /* 3️⃣ build API response */
      const summaries = await Promise.all(
        jobs.map(async (job) => {
          const file = job.file ?? fileByName[job.fileName];

          const objectName = job.summaryCsvUrl
            ? toObjectName(job.summaryCsvUrl)
            : file?.summaryFileName ?? `summary-${job.id}.md`;

          /* page estimate from live word-count */
          let pages = file?.pages ?? job.totalPages ?? 0;
          try {
            const txt = await fetchSummaryText(objectName);
            pages = Math.ceil(txt.trim().split(/\s+/).length / WORDS_PER_PAGE);
          } catch (e) {
            console.warn("fetchSummaryText failed:", (e as any).message);
          }

          /* signed URL (3 days) */
          const [signedUrl] = await bucket.file(objectName).getSignedUrl({
            action: "read",
            expires: Date.now() + 3 * 86_400_000,
          });

          return {
            id: job.id,
            fileTitle: file?.title || job.fileName, // ← always populated
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

/* ───────── VIEW one summary raw markdown ───────── */
router.get(
  "/view",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.query as { id?: string };
    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }

    try {
      const userId = (req as any).user?.userId as string;
      const job = await prisma.summaryJob.findFirst({
        where: { id, userId },
        include: { file: true },
      });
      if (!job) {
        res.status(404).json({ error: "Summary job not found." });
        return;
      }

      const objectName = job.summaryCsvUrl
        ? toObjectName(job.summaryCsvUrl)
        : job.file?.summaryFileName ?? `summary-${job.id}.md`;

      const [buf] = await bucket.file(objectName).download();
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(buf);
    } catch (e) {
      console.error("[/api/summaries/view] Error:", e);
      res.status(404).json({ error: "Summary file not found in storage." });
    }
  }
);

export default router;

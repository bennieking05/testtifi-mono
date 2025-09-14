// ─── src/routes/summariesRoutes.ts ───────────────────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";
import { loadPromptConfig, savePromptConfig } from "../lib/promptConfig";

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

      /* 1️⃣ main query (+inline File join) */
      const jobs = await prisma.summaryJob.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { file: true },
      });

      /* helper types for TS strict-mode */
      type JobWithFile = (typeof jobs)[number];
      type FileWithMeta = Awaited<
        ReturnType<typeof prisma.file.findMany>
      >[number];

      /* 2️⃣ “orphan” lookup for jobs that lost their File row */
      const orphanNames = jobs
        .filter((j: JobWithFile) => !j.file)
        .map((j: { fileName: any }) => j.fileName);

      const extraFiles: FileWithMeta[] = orphanNames.length
        ? await prisma.file.findMany({
            where: { fileName: { in: orphanNames } },
          })
        : [];

      const fileByName = Object.fromEntries(
        extraFiles.map((f) => [f.fileName, f])
      );

      /* 3️⃣ build response */
      const summaries = await Promise.all(
        jobs.map(async (job: JobWithFile) => {
          const file = job.file ?? fileByName[job.fileName];

          const objectName = job.summaryCsvUrl
            ? toObjectName(job.summaryCsvUrl)
            : file?.summaryFileName ?? `summary-${job.id}.md`;

          /* page estimate – fall back to prior values; only fetch when finished and object exists */
          let pages = file?.pages ?? job.totalPages ?? 0;
          if (job.status === "complete") {
            try {
              const [exists] = await bucket.file(objectName).exists();
              if (exists) {
                const txt = await fetchSummaryText(objectName);
                const words = txt.trim().split(/\s+/).length;
                if (words > 0) pages = Math.ceil(words / WORDS_PER_PAGE);
              }
            } catch {
              // Silently ignore fetch errors (e.g., 404 for expired/missing object)
            }
          }

          /* signed URL (3 days) */
          const [signedUrl] = await bucket.file(objectName).getSignedUrl({
            action: "read",
            expires: Date.now() + 3 * 86_400_000,
          });

          /* duration (mins) – only when finishedAt exists */
          const timeMinutes =
            job.finishedAt && job.startedAt
              ? Math.max(
                  1,
                  Math.round(
                    (job.finishedAt.getTime() - job.startedAt.getTime()) /
                      1000 /
                      60
                  )
                )
              : undefined;

          return {
            id: job.id,
            fileTitle: file?.title || job.fileName,
            fileName: file?.fileName || job.fileName,
            summaryUrl: signedUrl,
            date: job.createdAt.toISOString(),
            pages,
            totalPages: job.totalPages,
            lastPageProcessed: job.lastPageProcessed,
            timeMinutes, // ← NEW
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

/* ───────── PROMPT CONFIG (GET/PUT) ───────── */
router.get(
  "/prompt-config",
  authenticateToken,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const cfg = loadPromptConfig();
      res.json(cfg);
    } catch (err) {
      console.error("[/api/summaries/prompt-config] Error:", err);
      res.status(500).json({ error: "Failed to load config" });
    }
  }
);

router.put(
  "/prompt-config",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { system, temperature, maxTokens } = req.body || {};
      const saved = savePromptConfig({
        system: typeof system === "string" ? system : "",
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
      });
      res.json(saved);
    } catch (err) {
      console.error("[PUT /api/summaries/prompt-config] Error:", err);
      res.status(500).json({ error: "Failed to save config" });
    }
  }
);

export default router;

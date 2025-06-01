// ─── src/routes/previewRoutes.ts ────────────────────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import MarkdownIt from "markdown-it";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/* ───────── helpers ───────── */
const toObjectName = (u: string) => {
  try {
    const { pathname } = new URL(u);
    return pathname.substring(pathname.lastIndexOf("/") + 1);
  } catch {
    return u; // already a plain object name
  }
};

/* ───────── GET /api/preview?id=<summaryJobId> ───────── */
router.get(
  "/",
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
        res.status(404).json({ error: "Summary not found." });
        return;
      }

      const objectName = job.summaryCsvUrl
        ? toObjectName(job.summaryCsvUrl)
        : job.file?.summaryFileName ?? `summary-${job.id}.md`;

      const [buf] = await bucket.file(objectName).download();
      const htmlBody = md.render(buf.toString("utf-8"));

      /* minimalist “Word‑ish” style */
      const css = `
        body { font-family: "Calibri", Arial, sans-serif; font-size: 11pt; line-height: 1.4; margin: 0; }
        .page { max-width: 6.5in; margin: 0.75in auto; }
        table { width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 11pt; }
        th, td { border: 1px solid #d0d0d0; padding: 4pt 6pt; vertical-align: top; }
        th { background: #f2f2f2; }
        h1,h2,h3,h4 { margin-top: 18pt; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        code { font-family: "Courier New", monospace; }
      `;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Deposition Summary Preview</title>
  <style>${css}</style>
</head>
<body><div class="page">${htmlBody}</div></body>
</html>`);
      return;
    } catch (err) {
      console.error("[/api/preview] Error:", err);
      res.status(500).json({ error: "Failed to build preview." });
      return;
    }
  }
);

export default router;

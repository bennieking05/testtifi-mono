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
    return u;
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
      const raw = buf.toString("utf-8");
      const cleaned = stripContinuations(raw);
      const htmlBody = md.render(cleaned);

      const css = `
        /* Professional legal-style document */
        html, body { margin: 0; padding: 0; background: #fff; }
        .cover {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100vh;
          page-break-after: always;
          font-family: "Times New Roman", Georgia, serif;
        }
        .cover h1 { font-size: 30pt; margin: 0 0 8pt 0; font-weight: 700; }
        .cover p  { font-size: 12pt; margin: 2pt 0; }
        .page {
          max-width: 7in;
          margin: 1in auto;
          font-family: "Times New Roman", Georgia, serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #111;
        }
        h1 { font-size: 18pt; margin: 16pt 0 10pt; font-weight: 700; }
        h2 { font-size: 14pt; margin: 14pt 0 8pt; font-weight: 700; }
        h3 { font-size: 12pt; margin: 12pt 0 6pt; font-weight: 700; }
        p  { margin: 8pt 0; }
        hr { border: none; border-top: 1px solid #c8c8c8; margin: 14pt 0; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 10pt 0 16pt;
          table-layout: fixed;
        }
        thead th {
          background: #eef2f7;
          border: 1px solid #c8d0da;
          padding: 6pt 8pt;
          text-align: left;
          font-weight: 700;
        }
        tbody td {
          border: 1px solid #d8d8d8;
          padding: 6pt 8pt;
          vertical-align: top;
        }
        tbody tr:nth-child(even) td { background: #fafbfc; }
        code, pre { font-family: "Courier New", Courier, monospace; }
      `;

      // Prefer File.title, else fall back to the uploaded filename without extension
      const coverTitle = job.file?.title || (job.file?.fileName || job.fileName).replace(/\.[^.]+$/, "");
      // ← use job.file.pages instead of pageCount
      const coverPages = job.file?.pages ?? "";

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>Preview</title><style>${css}</style></head>
<body>
  <div class="cover">
    <h1>${coverTitle}</h1>
    ${coverPages ? `<p>Pages: ${coverPages}</p>` : ""}
  </div>
  <div class="page">${htmlBody}</div>
</body>
</html>`);
    } catch (err) {
      console.error("[/api/preview] Error:", err);
      res.status(500).json({ error: "Failed to build preview." });
    }
  }
);

export default router;


function stripContinuations(text: string): string {
  const banned = [
    /\bto be continued\b/i,
    /\blet me know if you'd like me to continue\b/i,
    /\blet me know if you(?:'|\s)\w* like me to continue\b/i,
    /\bprovide further clarification\b/i,
    /\bcan continue summarizing\b/i,
  ];
  return text.split(/\r?\n/).filter(l=>!any(l,banned)).join("\n");
  function any(l:string, arr:RegExp[]){
    return arr.some(re=>re.test(l));
  }
}

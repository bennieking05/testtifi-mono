// ─── src/routes/previewRoutes.ts ────────────────────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import { authenticateToken } from "../middlewares/authMiddleware";
import { getLogoDataUri } from "../utils/logo";
import { parseMarkdown } from "./downloadRoutes";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");

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
    const theme = (req.query as any)?.theme as string | undefined; // optional: "dark" | "light"
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

      // Check if summary is older than 3 days
      const RETENTION_DAYS = 3;
      const DAY_IN_MS = 24 * 60 * 60 * 1000;
      const cutoffDate = new Date(Date.now() - RETENTION_DAYS * DAY_IN_MS);
      
      if (job.finishedAt && job.finishedAt < cutoffDate) {
        // Summary is older than 3 days - check if it still exists
        if (!job.summaryCsvUrl && !job.file?.summaryFileName) {
          res.status(410).json({ 
            error: "This summary has been deleted per our 3-day retention policy. Summary content older than 3 days is automatically removed. Access may be available in extenuating circumstances - please contact support.",
            deleted: true,
            finishedAt: job.finishedAt.toISOString(),
          });
          return;
        }
      }

      const objectName = job.summaryCsvUrl
        ? toObjectName(job.summaryCsvUrl)
        : job.file?.summaryFileName ?? `summary-${job.id}.md`;
      const [buf] = await bucket.file(objectName).download();
      const raw = buf.toString("utf-8");
      const cleaned = stripContinuations(raw);
      const summaryName = (job as any)?.summaryName as string | null;
      const deponent = (job as any)?.deponent ?? job.file?.deponent ?? undefined;
      const titleRow = summaryName || job.file?.title || "Deposition Summary";
      const headerMeta = buildHeaderMeta(job, titleRow, typeof deponent === "string" ? deponent : undefined);
      const { meta, rows } = parseMarkdown(cleaned);
      const deriveMaxPageFromRows = (r: string[][]): number => {
        let maxPage = 0;
        for (const [label] of r) {
          const m = label.match(/(\d+)(?::\d+)?(?:\s*[-–]\s*(\d+)(?::\d+)?)?/);
          if (m) {
            const a = parseInt(m[1], 10);
            const b = m[2] ? parseInt(m[2], 10) : a;
            if (!Number.isNaN(a)) maxPage = Math.max(maxPage, a);
            if (!Number.isNaN(b)) maxPage = Math.max(maxPage, b);
          }
        }
        return maxPage;
      };
      const mergedMeta = [...new Set([...meta, ...headerMeta])];
      const tableRowsHtml = rows
        .map(([p, s]) => {
          // Split very long testimony into bite-sized chunks (1–2 sentences each)
          const sentences = s
            .split(/(?<=[.!?])\s+(?=[A-Z(])/)
            .map((t) => t.trim())
            .filter(Boolean);
          if (sentences.length <= 2) {
            return `<tr><td>${escapeHtml(p)}</td><td>${escapeHtml(s).replace(/\n/g, '<br/>')}</td></tr>`;
          }
          const chunks: string[] = [];
          for (let i = 0; i < sentences.length; i += 2) {
            chunks.push(sentences.slice(i, i + 2).join(" "));
          }
          return chunks
            .map(
              (chunk, idx) =>
                `<tr><td>${escapeHtml(idx === 0 ? p : `${p}`)}</td><td>${escapeHtml(chunk).replace(/\n/g, '<br/>')}</td></tr>`
            )
            .join("\n");
        })
        .join("\n");
      const tableHtml = `
        <table>
          <thead>
            <tr>
              <th style="width: 22%">Page(s)</th>
              <th>Testimony</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>`;
      const htmlBody = `${tableHtml}`;

      const css = `
        /* Professional legal-style document with light/dark themes */
        :root {
          --bg: #ffffff;
          --text: #111111;
          --muted: #475569;
          --panel: #ffffff;
          --border: #c8d0da;
          --table-header: #eef2f7;
          --accent: #5674BC;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #0b1220;
            --text: #e2e8f0;
            --muted: #94a3b8;
            --panel: #0f172a;
            --border: #334155;
            --table-header: #1f2937;
            --accent: #8ab4ff;
          }
        }
        .dark {
          --bg: #0b1220;
          --text: #e2e8f0;
          --muted: #94a3b8;
          --panel: #0f172a;
          --border: #334155;
          --table-header: #1f2937;
          --accent: #8ab4ff;
        }
        .light {
          --bg: #ffffff;
          --text: #111111;
          --muted: #475569;
          --panel: #ffffff;
          --border: #c8d0da;
          --table-header: #eef2f7;
          --accent: #5674BC;
        }
        html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
        .cover {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100vh;
          page-break-after: always;
          font-family: "Times New Roman", Georgia, serif;
        }
        .cover h1 { font-size: 30pt; margin: 0 0 8pt 0; font-weight: 700; color: var(--text); }
        .cover p  { font-size: 12pt; margin: 2pt 0; color: var(--text); }
        .cover img { max-width: 280px; height: auto; margin-bottom: 16pt; }
        .tm-logo-wrap {
          width: 281px;
          height: 60px;
          margin: 18px auto 24px auto;
          display: block;
        }
        .tm-logo-wrap img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center;
          display: block;
        }
        .page {
          max-width: 7in;
          margin: 1in auto;
          font-family: "Times New Roman", Georgia, serif;
          font-size: 12pt;
          line-height: 1.6;
          color: var(--text);
        }
        h1 { font-size: 18pt; margin: 16pt 0 10pt; font-weight: 700; }
        h2 { font-size: 14pt; margin: 14pt 0 8pt; font-weight: 700; }
        h3 { font-size: 12pt; margin: 12pt 0 6pt; font-weight: 700; }
        p  { margin: 8pt 0; color: var(--text); }
        hr { border: none; border-top: 1px solid var(--border); margin: 14pt 0; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 10pt 0 16pt;
          table-layout: fixed;
          border: 2px solid var(--border);
          background: var(--panel);
        }
        table, th, td { border: 1px solid var(--border); }
        th, td { border-left: 1px solid var(--border); border-right: 1px solid var(--border); }
        thead th {
          background: var(--table-header);
          border: 1px solid var(--border);
          padding: 6pt 8pt;
          text-align: left;
          font-weight: 700;
          color: var(--text);
        }
        tbody td {
          border: 1px solid var(--border);
          padding: 6pt 8pt;
          vertical-align: top;
          color: var(--text);
        }
        tbody tr:nth-child(even) td { background: var(--panel); }
        code, pre { font-family: "Courier New", Courier, monospace; }
      `;

      const getMetaValue = (label: string): string | undefined => {
        const entry = mergedMeta.find((line) => line.toLowerCase().startsWith(`${label.toLowerCase()}:`));
        if (!entry) return undefined;
        const idx = entry.indexOf(":");
        if (idx === -1) return entry.trim();
        return entry.slice(idx + 1).trim();
      };

      // Prefer metadata values when available to match DOCX/PDF exports
      const metaCaseTitle = getMetaValue("Case Title");
      const metaCaseCaption = getMetaValue("Case Caption");
      const metaDeponent = getMetaValue("Deponent");
      const metaSourceFile = getMetaValue("Source File");
      const metaPagesValue = getMetaValue("Pages");
      const metaDepositionDate = getMetaValue("Date of Deposition");

      const coverTitle = metaCaseTitle || job.file?.title || (job.file?.fileName || job.fileName).replace(/\.[^.]+$/, "");
      const numericPages =
        metaPagesValue && !Number.isNaN(Number(metaPagesValue))
          ? Number(metaPagesValue)
          : typeof job.file?.pages === "number"
          ? job.file.pages
          : job.file?.pages
          ? parseInt(String(job.file.pages), 10)
          : undefined;
      const derivedPages = deriveMaxPageFromRows(rows);
      const coverPages =
        (numericPages && numericPages > 0 ? numericPages : derivedPages > 0 ? derivedPages : null);
      const logoDataUri = getLogoDataUri();
      const logoHtml = logoDataUri
        ? `<div class="tm-logo-wrap" data-logo-variant="embedded"><img data-preview-logo="true" src="${logoDataUri}" alt="Testifi AI Logo" /></div>`
        : "";

      // Extract deposition date from metadata
      let depositionDate: string | null = null;
      if (metaDepositionDate) {
        depositionDate = metaDepositionDate;
      } else {
        const dateLine = meta.find(l => /date\s+of\s+deposition\s*:/i.test(l));
        if (dateLine && !dateLine.includes("[Unknown]")) {
          const mDate = dateLine.match(/date\s+of\s+deposition\s*:\s*(.+)/i);
          if (mDate) depositionDate = mDate[1].trim();
        }
      }

      // Extract deponent name
      let deponentName = metaDeponent || job.file?.deponent || "Not Specified";
      if (!metaDeponent) {
        const titleLike = meta.find(l => /transcript\s+summary\s+of\s+/i.test(l));
        if (titleLike) {
          const m1 = titleLike.match(/transcript\s+summary\s+of\s+(.+)/i);
          if (m1 && !m1[1].includes("[Unknown]")) {
            deponentName = m1[1].trim();
          }
        }
      }

      // Construct enhanced title to match DOCX format
      let titleOfDocument = `Transcript Summary of ${deponentName}`;
      
      const uploadDate = new Date(job.createdAt || new Date()).toLocaleDateString();
      const downloadDate = new Date().toLocaleDateString();
      const dateForCover = depositionDate || uploadDate;
      const caseCaption = metaCaseCaption;
      const sourceFileDisplay = metaSourceFile || job.fileName || "Unknown";
      
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>Preview</title><style>${css}</style></head>
<body ${theme === "dark" ? 'class="dark"' : theme === "light" ? 'class="light"' : ""}>
  <div class="cover">
    ${logoHtml}
    <h1>${titleOfDocument}</h1>
    <div style="text-align: left; margin: 20px 0;">
      <p><strong>Deponent:</strong> ${deponentName}</p>
      <p><strong>Case Title:</strong> ${coverTitle}</p>
      ${caseCaption ? `<p><strong>Case Caption:</strong> ${caseCaption}</p>` : ""}
      <p><strong>Source File:</strong> ${sourceFileDisplay}</p>
      ${coverPages ? `<p><strong>Pages:</strong> ${coverPages}</p>` : ""}
      ${depositionDate ? `<p><strong>Date of Deposition:</strong> ${depositionDate}</p>` : ""}
      <p><strong>Date:</strong> ${dateForCover}</p>
      <p><strong>Upload Date:</strong> ${uploadDate}</p>
      <p><strong>Download Date:</strong> ${downloadDate}</p>
    </div>
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHeaderMeta(job: any, title: string, deponent?: string): string[] {
  // Extract source filename from job.fileName
  const sourceFileName = job.fileName || "Unknown";
  
  return [
    title,
    `Deponent: ${deponent || "Not Specified"}`,
    `Case Title: ${job.file?.title || "Not Specified"}`,
    `Source File: ${sourceFileName}`,
    ...(job.file?.pages ? [`Pages: ${job.file.pages}`] : []),
    `Date: ${new Date(job.createdAt || new Date()).toLocaleDateString()}`,
    "",
  ];
}

// ─── src/routes/previewRoutes.ts ────────────────────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import { authenticateToken } from "../middlewares/authMiddleware";
import { getLogoDataUri } from "../utils/logo";

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
      const { meta, rows } = parseToRows(cleaned);
      const filteredMeta = meta.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        const suppressedPrefixes = [
          "Deponent:",
          "Case Title:",
          "Source File:",
          "Pages:",
          "Date:",
          "Upload Date:",
          "Download Date:",
        ];
        return !suppressedPrefixes.some((prefix) =>
          trimmed.toLowerCase().startsWith(prefix.toLowerCase())
        );
      });
      const metaHtml = filteredMeta.map((m) => `<p>${escapeHtml(m)}</p>`).join("\n");
      const tableRowsHtml = rows
        .map(
          ([p, s]) =>
            `<tr><td>${escapeHtml(p)}</td><td>${escapeHtml(s).replace(/\n/g, '<br/>')}</td></tr>`
        )
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
      const htmlBody = `${metaHtml}\n${tableHtml}`;

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
        .cover img { max-width: 280px; height: auto; margin-bottom: 16pt; }
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
        table, th, td { border: 1px solid #c8d0da; }
        th, td { border-left: 1px solid #c8d0da; border-right: 1px solid #c8d0da; }
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
      const logoDataUri = getLogoDataUri();
      const logoHtml = logoDataUri ? `<img src="${logoDataUri}" alt="Testifi AI Logo" />` : "";

      // Extract deposition date from metadata
      let depositionDate: string | null = null;
      const dateLine = meta.find(l => /date\s+of\s+deposition\s*:/i.test(l));
      if (dateLine && !dateLine.includes("[Unknown]")) {
        const mDate = dateLine.match(/date\s+of\s+deposition\s*:\s*(.+)/i);
        if (mDate) depositionDate = mDate[1].trim();
      }

      // Extract deponent name
      let deponentName = job.file?.deponent || "Not Specified";
      const titleLike = meta.find(l => /transcript\s+summary\s+of\s+/i.test(l));
      if (titleLike) {
        const m1 = titleLike.match(/transcript\s+summary\s+of\s+(.+)/i);
        if (m1 && !m1[1].includes("[Unknown]")) {
          deponentName = m1[1].trim();
        }
      }

      // Construct enhanced title to match DOCX format
      let titleOfDocument = `Transcript Summary of ${deponentName}`;
      
      const uploadDate = new Date(job.createdAt || new Date()).toLocaleDateString();
      const downloadDate = new Date().toLocaleDateString();
      const dateForCover = depositionDate || uploadDate;
      
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>Preview</title><style>${css}</style></head>
<body>
  <div class="cover">
    ${logoHtml}
    <h1>${titleOfDocument}</h1>
    <div style="text-align: left; margin: 20px 0;">
      <p><strong>Deponent:</strong> ${deponentName}</p>
      <p><strong>Case Title:</strong> ${coverTitle}</p>
      <p><strong>Source File:</strong> ${job.fileName || "Unknown"}</p>
      ${coverPages ? `<p><strong>Pages:</strong> ${coverPages}</p>` : ""}
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

function parseToRows(mdText: string): { meta: string[]; rows: string[][] } {
  const clean = (s: string) =>
    s
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .trim();

  const isRule = (s: string) => /^(?:-{3,}|_{3,}|\*{3,})$/.test(s.trim());
  const pageRegex = /^(?:p(?:age)?\.?)?\s*\d+(?::\d+(?:-\d+)?)?(?:\s*[-–]\s*\d+(?::\d+)?)?/i;

  const meta: string[] = [];
  const rows: string[][] = [];
  let seenRow = false;

  mdText.split(/\r?\n/).forEach((raw) => {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("```")) return;
    if (isRule(trimmed)) return;

    trimmed = clean(trimmed);
    if (!trimmed) return;

    const rowMatch = trimmed.match(pageRegex);
    if (rowMatch) {
      seenRow = true;
      const label = rowMatch[0].replace(/\s+/g, " ").trim();
      let remainder = trimmed.slice(rowMatch[0].length).trim();
      remainder = remainder.replace(/^[-–:|]\s*/, "").trim();
      rows.push([label || "", remainder || ""]);
      return;
    }

    if (!seenRow) {
      meta.push(trimmed);
    }
  });

  return { meta, rows };
}


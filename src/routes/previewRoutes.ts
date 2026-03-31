// ─── src/routes/previewRoutes.ts ────────────────────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import { authenticateToken } from "../middlewares/authMiddleware";
import { getLogoDataUri } from "../utils/logo";
import {
  normalizeUnknownString,
  resolveSummaryMetadata,
  renderMetadataMarkdown,
} from "../utils/summaryMetadata";
import { formatDateInTimeZoneMDY, parseLooseDate } from "../utils/dateTime";
import { sanitizeSummaryMetaLanguage } from "../utils/summarySanitize";

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
      const metadata = await resolveSummaryMetadata(bucket, job as any);
      const metadataMarkdown = renderMetadataMarkdown(metadata);
      // Fallback chain for page count: metadata.totalPages > job.totalPages > job.file.pages
      const maxPage =
        (metadata.totalPages && metadata.totalPages > 0
          ? metadata.totalPages
          : job.totalPages && job.totalPages > 0
          ? job.totalPages
          : job.file?.pages
          ? Number(job.file.pages)
          : undefined) || undefined;
      const boundedRows = enforcePageBounds(
        rows.map(([p, s]) => [p, s] as [string, string]),
        { maxPage }
      );
      const PLACEHOLDER_STUB =
        "No summary generated for this page range; see transcript.";
      const displayRows: Array<[string, string]> = boundedRows.map(([p, s]) => {
        const text = (s || "").trim() === "—" ? PLACEHOLDER_STUB : s || "";
        return [p, sanitizeSummaryMetaLanguage(text)];
      });
      const suppressedPrefixes = [
        "Deponent:",
        "Case Title:",
        "Source File:",
        "Pages:",
        "Date:",
        "Upload Date:",
        "Download Date:",
        "Case Caption:",
        "Title of Document:",
        "Date of Deposition:",
      ];

      const lineMatchesSuppressedPrefix = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        const lower = trimmed.toLowerCase();
        return suppressedPrefixes.some((prefix) => {
          const pl = prefix.toLowerCase();
          const bare = pl.replace(/:\s*$/, "");
          return (
            lower.startsWith(pl) ||
            lower.startsWith(`${bare}:`) ||
            lower.startsWith(`${bare}.`)
          );
        });
      };

      const filteredMeta = meta.filter((line) => !lineMatchesSuppressedPrefix(line));
      const metadataParagraphs = metadataMarkdown
        .split("\n")
        .filter(Boolean)
        .filter((line) => !lineMatchesSuppressedPrefix(line));
      const metaHtml = [...metadataParagraphs, ...filteredMeta]
        .map((m) => `<p>${escapeHtml(m)}</p>`)
        .join("\n");
      const tableRowsHtml = displayRows
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

      const coverTitle =
        metadata.caseTitle ||
        job.file?.title ||
        (job.file?.fileName || job.fileName).replace(/\.[^.]+$/, "");
      // Fallback chain for cover page display: metadata.totalPages > job.totalPages > job.file.pages
      const coverPages =
        (metadata.totalPages && metadata.totalPages > 0
          ? String(metadata.totalPages)
          : job.totalPages && job.totalPages > 0
          ? String(job.totalPages)
          : job.file?.pages ?? "") || "";
      const logoDataUri = getLogoDataUri();
      const logoHtml = logoDataUri ? `<img src="${logoDataUri}" alt="Testifi AI Logo" />` : "";

      // Extract deposition date from metadata
      const depositionDateRaw = normalizeUnknownString(metadata.depositionDate);
      // If already in human-readable format (e.g., "July 7, 2022"), use as-is to avoid timezone shift.
      const isHumanReadable = depositionDateRaw && /^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/.test(depositionDateRaw.trim());
      const depositionDateDisplay = isHumanReadable
        ? depositionDateRaw
        : (parseLooseDate(depositionDateRaw) ? formatDateInTimeZoneMDY(parseLooseDate(depositionDateRaw)!) : (depositionDateRaw || ""));

      // Extract deponent name
      const deponentName = metadata.deponent || job.file?.deponent || "Not Specified";

      // Construct enhanced title to match DOCX format
      let titleOfDocument = `Transcript Summary of ${deponentName}`;
      
      const uploadDate = formatDateInTimeZoneMDY(metadata.uploadDate || job.createdAt || new Date());
      const downloadDate = formatDateInTimeZoneMDY(new Date());

      // Build judge warnings HTML if any
      let warningsHtml = "";
      if (metadata.judgeResults && !metadata.judgeResults.allPassed) {
        const warningsList = metadata.judgeResults.judges
          .filter((j) => !j.passed || j.warnings.length > 0)
          .flatMap((j) => j.warnings.map((w) => `<li><strong>${escapeHtml(j.name)}:</strong> ${escapeHtml(w)}</li>`))
          .join("");
        if (warningsList) {
          warningsHtml = `
    <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px; margin: 20px 0;">
      <strong style="color: #856404;">⚠️ Validation Warnings:</strong>
      <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #856404;">${warningsList}</ul>
    </div>`;
        }
      }
      
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
      <p><strong>Date of Deposition:</strong> ${depositionDateDisplay || "[Unknown]"}</p>
      <p><strong>Upload Date:</strong> ${uploadDate}</p>
      <p><strong>Download Date:</strong> ${downloadDate}</p>
    </div>${warningsHtml}
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

  const splitMarkdownTableRow = (
    line: string
  ): { firstCell: string; restCells: string[] } | null => {
    if (!line.includes("|")) return null;
    const stripped = line.replace(/^\|+/, "").replace(/\|+$/, "").trim();
    const parts = stripped.split("|").map((p) => clean(p));
    if (parts.length < 2) return null;
    const first = (parts[0] || "").trim();
    const rest = parts.slice(1).map((p) => String(p || "").trim());
    // Skip header-ish rows
    if (/^page\s*\(s\)$/i.test(first) && rest[0] && /^testimony$/i.test(rest[0])) return null;
    if (/^page\s*number$/i.test(first) && rest[0] && /^testimony$/i.test(rest[0])) return null;
    if (first && rest.join("").trim()) return { firstCell: first, restCells: rest };
    return null;
  };

  mdText.split(/\r?\n/).forEach((raw) => {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("```")) return;
    if (isRule(trimmed)) return;

    trimmed = clean(trimmed);
    if (!trimmed) return;

    // Prefer parsing markdown table rows like: "| p.6:1-25 | testimony |"
    const pipeRow = splitMarkdownTableRow(trimmed);
    if (pipeRow) {
      seenRow = true;
      const label = pipeRow.firstCell.replace(/\s+/g, " ").trim();
      const remainder = pipeRow.restCells.join(" | ").trim();
      rows.push([label || "", remainder || ""]);
      return;
    }

    const normalized = trimmed.replace(/^\|+/, "").trim();
    const rowMatch = normalized.match(pageRegex);
    if (rowMatch) {
      seenRow = true;
      const label = rowMatch[0].replace(/\s+/g, " ").trim();
      let remainder = normalized.slice(rowMatch[0].length).trim();
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

function extractAllPages(label: string): number[] {
  const out: number[] = [];
  const re = /(?:^|[,\s|])(?:p(?:age)?\.?)?\s*(\d{1,6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label))) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}function enforcePageBounds(
  rows: Array<[string, string]>,
  opts: { maxPage?: number } = {}
): Array<[string, string]> {
  const maxPage = opts.maxPage && opts.maxPage > 0 ? opts.maxPage : null;
  if (!maxPage) return rows;

  const kept: Array<[string, string]> = [];
  let sawValidRow = false;
  let invalidStreak = 0;
  for (const [p, s] of rows) {
    const pages = extractAllPages(p);
    if (!pages.length) {
      kept.push([p, s]);
      continue;
    }
    const invalid = pages.some((n) => n < 1 || n > maxPage);
    if (invalid) {
      if (!sawValidRow) continue; // drop leading p.0 etc
      invalidStreak++;
      if (invalidStreak >= 10) break; // truncate hallucinated tail
      continue;
    }
    sawValidRow = true;
    invalidStreak = 0;
    kept.push([p, s]);
  }
  return kept;
}

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
import { splitDepositionOverview } from "../utils/summaryOverviewDelimiter";
import { sanitizeSummaryMetaLanguage } from "../utils/summarySanitize";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");

// 4-column row structure for deposition summaries
interface PreviewSummaryRow {
  pageLine: string;
  witness: string;
  topic: string;
  summary: string;
}

const toObjectName = (u: string) => {
  try {
    const { pathname } = new URL(u);
    return pathname.substring(pathname.lastIndexOf("/") + 1);
  } catch {
    return u;
  }
};

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

      const metadata = await resolveSummaryMetadata(bucket, job as any);
      const deponentName = metadata.deponent || job.file?.deponent || "Not Specified";

      const { mdForTableParsing, depositionOverview: overviewFromMd } = splitDepositionOverview(cleaned);
      const depositionOverviewText =
        (overviewFromMd && overviewFromMd.trim()) ||
        (metadata.depositionOverview && String(metadata.depositionOverview).trim()) ||
        "";

      const { meta, rows } = parseToRows(mdForTableParsing, deponentName);
      const metadataMarkdown = renderMetadataMarkdown(metadata);
      
      const maxPage =
        (metadata.totalPages && metadata.totalPages > 0
          ? metadata.totalPages
          : job.totalPages && job.totalPages > 0
          ? job.totalPages
          : job.file?.pages
          ? Number(job.file.pages)
          : undefined) || undefined;
      const boundedRows = enforcePageBounds(rows, { maxPage });
      const PLACEHOLDER_STUB =
        "No summary generated for this page range; see transcript.";
      const displayRows = boundedRows.map((r) => ({
        ...r,
        summary: sanitizeSummaryMetaLanguage(
          (r.summary || "").trim() === "—" ? PLACEHOLDER_STUB : r.summary || ""
        ),
      }));
      const hasMultipleWitnesses =
        new Set(displayRows.map((r) => r.witness).filter(Boolean)).size > 1;

      const suppressedPrefixes = [
        "Deponent:", "Case Title:", "Source File:", "Pages:", "Date:",
        "Upload Date:", "Download Date:", "Case Caption:", "Title of Document:", "Date of Deposition:",
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
      
      const tableRowsHtml = hasMultipleWitnesses
        ? displayRows
            .map(
              (row) =>
                `<tr><td>${escapeHtml(row.pageLine)}</td><td>${escapeHtml(row.witness)}</td><td>${escapeHtml(row.summary).replace(/\n/g, "<br/>")}</td></tr>`
            )
            .join("\n")
        : displayRows
            .map(
              (row) =>
                `<tr><td>${escapeHtml(row.pageLine)}</td><td>${escapeHtml(row.summary).replace(/\n/g, "<br/>")}</td></tr>`
            )
            .join("\n");

      const tableHtml = hasMultipleWitnesses
        ? `
        <table>
          <thead>
            <tr>
              <th style="width: 15%">Page/Line</th>
              <th style="width: 20%">Witness</th>
              <th style="width: 65%">Summary</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>`
        : `
        <table>
          <thead>
            <tr>
              <th style="width: 18%">Page/Line</th>
              <th style="width: 82%">Summary</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>`;
      const overviewHtml = depositionOverviewText
        ? `<section class="deposition-overview"><h2>Deposition overview</h2>${depositionOverviewText
            .split(/\n\s*\n/)
            .filter((b) => b.trim())
            .map((b) => `<p>${escapeHtml(b.trim()).replace(/\n/g, "<br/>")}</p>`)
            .join("\n")}</section>`
        : "";
      const htmlBody = `${metaHtml}\n${overviewHtml}\n${tableHtml}`;

      const css = `
        html, body { margin: 0; padding: 0; background: #fff; }
        .cover {
          display: flex; flex-direction: column; justify-content: center; align-items: center;
          height: 100vh; page-break-after: always; font-family: "Times New Roman", Georgia, serif;
        }
        .cover h1 { font-size: 30pt; margin: 0 0 8pt 0; font-weight: 700; }
        .cover p { font-size: 12pt; margin: 2pt 0; }
        .cover img { max-width: 280px; height: auto; margin-bottom: 16pt; }
        .page { max-width: 8in; margin: 1in auto; font-family: "Times New Roman", Georgia, serif; font-size: 11pt; line-height: 1.5; color: #111; }
        h1 { font-size: 18pt; margin: 16pt 0 10pt; font-weight: 700; }
        h2 { font-size: 14pt; margin: 14pt 0 8pt; font-weight: 700; }
        h3 { font-size: 12pt; margin: 12pt 0 6pt; font-weight: 700; }
        p { margin: 8pt 0; }
        hr { border: none; border-top: 1px solid #c8c8c8; margin: 14pt 0; }
        table { width: 100%; border-collapse: collapse; margin: 10pt 0 16pt; table-layout: fixed; }
        table, th, td { border: 1px solid #c8d0da; }
        th, td { border-left: 1px solid #c8d0da; border-right: 1px solid #c8d0da; }
        thead th { background: #eef2f7; border: 1px solid #c8d0da; padding: 6pt 6pt; text-align: left; font-weight: 700; font-size: 10pt; }
        tbody td { border: 1px solid #d8d8d8; padding: 4pt 6pt; vertical-align: top; font-size: 9pt; }
        tbody tr:nth-child(even) td { background: #fafbfc; }
        code, pre { font-family: "Courier New", Courier, monospace; }
      `;

      const coverTitle = metadata.caseCaption || metadata.caseTitle || job.file?.title || (job.file?.fileName || job.fileName).replace(/\.[^.]+$/, "");
      const coverPages = (metadata.totalPages && metadata.totalPages > 0 ? String(metadata.totalPages) : job.totalPages && job.totalPages > 0 ? String(job.totalPages) : job.file?.pages ?? "") || "";
      const logoDataUri = getLogoDataUri();
      const logoHtml = logoDataUri ? `<img src="${logoDataUri}" alt="Testifi AI Logo" />` : "";

      const depositionDateRaw = normalizeUnknownString(metadata.depositionDate);
      const isHumanReadable = depositionDateRaw && /^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/.test(depositionDateRaw.trim());
      const depositionDateDisplay = isHumanReadable ? depositionDateRaw : (parseLooseDate(depositionDateRaw) ? formatDateInTimeZoneMDY(parseLooseDate(depositionDateRaw)!) : (depositionDateRaw || ""));

      const titleOfDocument = `Transcript Summary of ${deponentName}`;
      const uploadDate = formatDateInTimeZoneMDY(metadata.uploadDate || job.createdAt || new Date());
      const downloadDate = formatDateInTimeZoneMDY(new Date());

      let warningsHtml = "";
      if (metadata.judgeResults && !metadata.judgeResults.allPassed) {
        const warningsList = metadata.judgeResults.judges
          .filter((j) => !j.passed || j.warnings.length > 0)
          .flatMap((j) => j.warnings.map((w) => `<li><strong>${escapeHtml(j.name)}:</strong> ${escapeHtml(w)}</li>`))
          .join("");
        if (warningsList) {
          warningsHtml = `<div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px; margin: 20px 0;"><strong style="color: #856404;">⚠️ Validation Warnings:</strong><ul style="margin: 8px 0 0 0; padding-left: 20px; color: #856404;">${warningsList}</ul></div>`;
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
      ${hasMultipleWitnesses ? `<p><strong>Deponent:</strong> ${deponentName}</p>` : ""}
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
  const banned = [/\bto be continued\b/i, /\blet me know if you'd like me to continue\b/i, /\blet me know if you(?:'|\s)\w* like me to continue\b/i, /\bprovide further clarification\b/i, /\bcan continue summarizing\b/i];
  return text.split(/\r?\n/).filter(l => !banned.some(re => re.test(l))).join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function parseToRows(mdText: string, witness: string = "Not Specified"): { meta: string[]; rows: PreviewSummaryRow[] } {
  const clean = (s: string) => s.replace(/```[\s\S]*?```/g, "").replace(/<br\s*\/?>/gi, "\n").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
  const isRule = (s: string) => /^(?:-{3,}|_{3,}|\*{3,})$/.test(s.trim());
  const pageRegex = /^(?:p(?:age)?\.?)?\s*\d+(?::\d+)?(?:\s*[-–]\s*\d+(?::\d+)?)?/i;

  const meta: string[] = [];
  const rows: PreviewSummaryRow[] = [];
  let seenRow = false;

  const splitMarkdownTableRow = (line: string): string[] | null => {
    if (!line.includes("|")) return null;
    const stripped = line.replace(/^\|+/, "").replace(/\|+$/, "").trim();
    const parts = stripped.split("|").map((p) => clean(p));
    if (parts.length < 2) return null;
    const first = (parts[0] || "").trim().toLowerCase();
    if (first === "page/line" || first === "page(s)" || first === "page number") return null;
    return parts.map(p => p.trim());
  };


  mdText.split(/\r?\n/).forEach((raw) => {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("```")) return;
    if (isRule(trimmed)) return;
    trimmed = clean(trimmed);
    if (!trimmed) return;

    const cells = splitMarkdownTableRow(trimmed);
    if (cells && cells.length >= 2) {
      const pageLineCell = cells[0];
      const pageMatch = pageLineCell.match(pageRegex);
      if (pageMatch) {
        seenRow = true;
        if (cells.length >= 4) {
          rows.push({
            pageLine: pageLineCell,
            witness: (cells[1] || "").trim() || witness,
            topic: "",
            summary: cells.slice(3).join(" | ").trim() || "",
          });
        } else if (cells.length >= 3) {
          rows.push({
            pageLine: pageLineCell,
            witness,
            topic: "",
            summary: cells.slice(2).join(" | ").trim() || "",
          });
        } else {
          rows.push({
            pageLine: pageLineCell,
            witness,
            topic: "",
            summary: (cells[1] || "").trim(),
          });
        }
        return;
      }
    }

    const normalized = trimmed.replace(/^\|+/, "").trim();
    const rowMatch = normalized.match(pageRegex);
    if (rowMatch) {
      seenRow = true;
      const pageLine = rowMatch[0].replace(/\s+/g, " ").trim();
      let remainder = normalized.slice(rowMatch[0].length).trim().replace(/^[-–:|]\s*/, "").trim();
      rows.push({ pageLine, witness, topic: "", summary: remainder || "" });
      return;
    }

    if (!seenRow) meta.push(trimmed);
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
}function enforcePageBounds(rows: PreviewSummaryRow[], opts: { maxPage?: number } = {}): PreviewSummaryRow[] {
  const maxPage = opts.maxPage && opts.maxPage > 0 ? opts.maxPage : null;
  if (!maxPage) return rows;
  const kept: PreviewSummaryRow[] = [];
  let sawValidRow = false;
  let invalidStreak = 0;
  for (const row of rows) {
    const pages = extractAllPages(row.pageLine);
    if (!pages.length) { kept.push(row); continue; }
    const invalid = pages.some((n) => n < 1 || n > maxPage);
    if (invalid) {
      if (!sawValidRow) continue;
      invalidStreak++;
      if (invalidStreak >= 10) break;
      continue;
    }
    sawValidRow = true;
    invalidStreak = 0;
    kept.push(row);
  }
  return kept;
}
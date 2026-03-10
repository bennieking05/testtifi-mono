// src/worker/stages/pageCounter.ts
// Stage 1: Page Counter - Counts PDF pages and detects internal transcript page numbering

import pdf from "pdf-parse";
import mammoth from "mammoth";
import vision from "@google-cloud/vision";
import { Storage } from "@google-cloud/storage";

const storage = new Storage();
const summaryBucket = storage.bucket("deposition-summaries");
const visionClient = new vision.ImageAnnotatorClient();

export interface PageCountResult {
  pdfPageCount: number;
  transcriptMaxPage: number;
  totalPages: number;
  confidence: "high" | "medium" | "low";
  method: "text-parse" | "vision-ocr" | "hybrid" | "fallback";
  transcript: string; // full extracted text for downstream stages
}

export interface PageCountInput {
  buffer: Buffer;
  filename: string;
  gcsUri: string;
  jobId: string;
}

/**
 * Stage 1: Extract text from the document and determine page counts.
 * - pdfPageCount: number of physical PDF pages
 * - transcriptMaxPage: highest internal transcript page number detected
 * - totalPages: the count to use for display (prefers transcript numbering when credible)
 */
export async function countPages(input: PageCountInput): Promise<PageCountResult> {
  const { buffer, filename, gcsUri, jobId } = input;

  // Extract full text (may fall back to Vision OCR for scanned PDFs)
  const { text: transcript, method: extractMethod, pdfPageCount } = await extractFullText(
    buffer,
    filename,
    gcsUri,
    jobId
  );

  // Detect internal transcript page numbering
  let transcriptMaxPage = detectTranscriptMaxPage(transcript);
  let method: PageCountResult["method"] = extractMethod;
  let confidence: PageCountResult["confidence"] = "high";

  // If we couldn't detect internal transcript page numbering from extracted text,
  // run a Vision OCR probe on the last few PDF pages to recover "Page X of Y"/page-line headers.
  if (!transcriptMaxPage || transcriptMaxPage <= 0) {
    try {
      const tailPages = Array.from({ length: 8 }, (_, i) => pdfPageCount - i).filter((n) => n >= 1);
      const ocrTail = await extractTextWithVision(gcsUri, `${jobId}-pagecount`, { pages: tailPages });

      const candidates: number[] = [];
      for (const m of ocrTail.matchAll(/\b(?:Page|Pg\.?)\s+(\d{1,6})\b/gi)) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n >= 1 && n <= 5000) candidates.push(n);
      }
      for (const m of ocrTail.matchAll(/\bp\.\s*(\d{1,6})(?:\b|:)/gi)) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n >= 1 && n <= 5000) candidates.push(n);
      }

      const ocrGuess = pickRobustMax(candidates, pdfPageCount);
      if (ocrGuess && ocrGuess > 0) {
        transcriptMaxPage = ocrGuess;
        method = "hybrid";
        confidence = "medium";
      }
    } catch (e) {
      console.warn(`[${jobId}] Vision page-count probe failed; continuing without it`);
      confidence = "low";
    }
  }

  // Choose the best total page count
  const totalPages = chooseTotalTranscriptPages({ pdfPageCount, transcriptMaxPage });

  // Adjust confidence based on detection quality
  if (transcriptMaxPage > 0 && Math.abs(transcriptMaxPage - totalPages) <= 2) {
    confidence = "high";
  } else if (transcriptMaxPage === 0 && pdfPageCount > 0) {
    confidence = "medium";
  }

  console.log(
    `[${jobId}] PageCounter: pdfPages=${pdfPageCount}, transcriptMax=${transcriptMaxPage}, ` +
      `total=${totalPages}, method=${method}, confidence=${confidence}`
  );

  return {
    pdfPageCount,
    transcriptMaxPage,
    totalPages,
    confidence,
    method,
    transcript,
  };
}

// ─── Text Extraction ─────────────────────────────────────────────────────────

interface ExtractResult {
  text: string;
  method: "text-parse" | "vision-ocr";
  pdfPageCount: number;
}

async function extractFullText(
  buffer: Buffer,
  filename: string,
  gcsUri: string,
  jobId: string
): Promise<ExtractResult> {
  const isPDF = filename.toLowerCase().endsWith(".pdf");
  const isDocx = /\.(docx?|DOCX?)$/.test(filename);

  if (isPDF) {
    const renderPage = (pageData: any) => {
      const render_options = {
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      };
      return pageData.getTextContent(render_options).then(function (textContent: any) {
        let lastY,
          text = "";
        for (let item of textContent.items) {
          if (lastY == item.transform[5] || !lastY) {
            text += item.str;
          } else {
            text += "\n" + item.str;
          }
          lastY = item.transform[5];
        }
        return `---PAGE ${pageData.pageNumber}---` + "\n" + text;
      });
    };

    const parsed = await pdf(buffer, { pagerender: renderPage });
    const trimmed = parsed.text.trim();
    const nonWhitespace = trimmed.replace(/\s/g, "").length;
    const pageCount = parsed.numpages || 1;

    const parts = parsed.text.split(/---PAGE\s+\d+---\s*\r?\n/i);
    const pageTexts = parts.length > 1 ? parts.slice(1) : [];
    const pageNonWs = pageTexts.map((t: string) => t.replace(/\s/g, "").length);
    const sparseThreshold = 40;
    const sparseCount = pageNonWs.filter((n: number) => n < sparseThreshold).length;
    const sparseRatio = pageNonWs.length ? sparseCount / pageNonWs.length : 0;
    const avgNonWsPerPage = pageNonWs.length
      ? Math.round(pageNonWs.reduce((a: number, b: number) => a + b, 0) / pageNonWs.length)
      : Math.round(nonWhitespace / Math.max(1, pageCount));

    const markerOverhead = pageCount * 20;
    const looksTextBased =
      nonWhitespace > 100 + markerOverhead &&
      !(pageCount >= 10 && (sparseRatio >= 0.6 || avgNonWsPerPage < 80));

    if (looksTextBased) {
      console.log(
        `[${jobId}] PDF text extraction successful: ${trimmed.length} chars, avg/page≈${avgNonWsPerPage}`
      );
      return { text: parsed.text, method: "text-parse", pdfPageCount: pageCount };
    }

    console.log(
      `[${jobId}] PDF appears scanned/mixed; using Vision OCR. sparseRatio=${sparseRatio.toFixed(2)}`
    );
    const visionText = await extractTextWithVision(gcsUri, jobId);
    return { text: visionText, method: "vision-ocr", pdfPageCount: pageCount };
  }

  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value, method: "text-parse", pdfPageCount: 1 };
  }

  return { text: buffer.toString("utf-8"), method: "text-parse", pdfPageCount: 1 };
}

export async function extractTextWithVision(
  gcsUri: string,
  jobId: string,
  opts: { pages?: number[] } = {}
): Promise<string> {
  const invocationId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const destinationUri = `gs://${summaryBucket.name}/vision-output/${jobId}/${invocationId}/`;
  const pages = Array.isArray(opts.pages)
    ? Array.from(new Set(opts.pages.filter((n) => Number.isFinite(n) && n >= 1))).sort((a, b) => a - b)
    : undefined;

  const [operation] = await visionClient.asyncBatchAnnotateFiles({
    requests: [
      {
        inputConfig: {
          gcsSource: { uri: gcsUri },
          mimeType: "application/pdf",
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        ...(pages && pages.length ? { pages } : {}),
        outputConfig: { gcsDestination: { uri: destinationUri }, batchSize: 1 },
      },
    ],
  });
  await operation.promise();

  const [files] = await summaryBucket.getFiles({
    prefix: `vision-output/${jobId}/${invocationId}/`,
  });
  const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith(".json"));
  jsonFiles.sort((a, b) => {
    const na = parseInt(a.name.match(/output-(\d+)-to/)?.[1] || "0", 10);
    const nb = parseInt(b.name.match(/output-(\d+)-to/)?.[1] || "0", 10);
    return na - nb;
  });

  let combined = "";
  let globalPageIndex = 1;

  for (const f of jsonFiles) {
    const [raw] = await f.download();
    const parsed = JSON.parse(raw.toString());
    for (const r of parsed.responses) {
      const pageText = r.fullTextAnnotation?.text || "";
      combined += `---PAGE ${globalPageIndex}---` + "\n" + pageText + "\n";
      globalPageIndex++;
    }
  }

  await Promise.all(files.map((f) => f.delete().catch(() => {})));
  return combined.trim();
}

// ─── Page Number Detection ───────────────────────────────────────────────────

export function detectTranscriptMaxPage(transcript: string): number {
  const text = transcript.replace(/^---PAGE\s+\d+---\s*$/gim, "\n");

  let maxFromRange = 0;
  let maxFromPageOfY = 0; // "Page X of Y" - captures Y (total)
  const pageWordCandidates: number[] = [];
  const pDotCandidates: number[] = [];
  const pageLineCandidates: number[] = [];

  const median = (nums: number[]) => {
    if (!nums.length) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const filterOutliers = (nums: number[]) => {
    if (!nums.length) return nums;
    const med = Math.max(1, median(nums));
    const cap = Math.max(1000, Math.round(med * 10));
    return nums.filter((n) => n >= 1 && n <= 5000 && n <= cap);
  };

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const range = line.match(/^\(?\s*Pages?\s+(\d{1,6})\s*[-–—]\s*(\d{1,6})\s*\)?$/i);
    if (range) {
      const end = Number.parseInt(range[2], 10);
      if (Number.isFinite(end)) maxFromRange = Math.max(maxFromRange, end);
      continue;
    }

    // 'Page X of Y' or 'Page X / Y' - extract Y (the total)
    // This is very reliable when present (common in court reporter footers)
    const pageOfY = line.match(/\b(?:Page|Pg\.?)\s+\d{1,6}\s+(?:of|\/)\s+(\d{1,6})\b/i);
    if (pageOfY) {
      const total = Number.parseInt(pageOfY[1], 10);
      if (Number.isFinite(total) && total >= 1 && total <= 5000) {
        maxFromPageOfY = Math.max(maxFromPageOfY, total);
      }
      continue;
    }

    const pageWord = line.match(/^(?:Page|Pg\.?)\s+(\d{1,6})$/i);
    if (pageWord) {
      const n = Number.parseInt(pageWord[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pageWordCandidates.push(n);
      continue;
    }

    const pageInline = line.match(/\b(?:Page|Pg\.?)\s+(\d{1,6})\b/i);
    if (pageInline && (/\bof\b/i.test(line) || /\//.test(line) || line.length <= 32)) {
      const n = Number.parseInt(pageInline[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pageWordCandidates.push(n);
      continue;
    }

    const pDot = line.match(/^p\.\s*(\d{1,6})(?:\b|:)/i);
    if (pDot) {
      const n = Number.parseInt(pDot[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pDotCandidates.push(n);
      continue;
    }

    const pDotInline = line.match(/\bp\.\s*(\d{1,6})(?:\b|:)/i);
    if (pDotInline && line.length <= 40) {
      const n = Number.parseInt(pDotInline[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pDotCandidates.push(n);
      continue;
    }

    const pl = line.match(/^(\d{1,6})\s*:\s*(\d{1,3})\b/);
    if (pl) {
      const page = Number.parseInt(pl[1], 10);
      const lineNo = Number.parseInt(pl[2], 10);
      if (
        Number.isFinite(lineNo) &&
        lineNo >= 0 &&
        lineNo <= 35 &&
        Number.isFinite(page) &&
        page >= 1 &&
        page <= 5000
      ) {
        pageLineCandidates.push(page);
      }
    }
  }

  // PRIORITY 0: If we found a (Pages X - Y) range, use it exclusively.
  if (maxFromRange > 0 && maxFromRange <= 5000) return maxFromRange;

  // PRIORITY 0.5: "Page X of Y" format - Y is the total, very reliable
  if (maxFromPageOfY > 0 && maxFromPageOfY <= 5000) return maxFromPageOfY;

  // PRIORITY 1: Explicit "Page X" or "Pg. X" markers are most reliable.
  const pw = filterOutliers(pageWordCandidates);
  if (pw.length >= 10) {
    return Math.max(...pw);
  }

  // PRIORITY 2: "p.X" notation (common in legal citations)
  const pd = filterOutliers(pDotCandidates);
  if (pd.length >= 5) {
    return Math.max(...pd);
  }

  // PRIORITY 3: Page:line patterns - fallback only
  if (pageLineCandidates.length < 100) {
    for (const m of text.matchAll(/\b(\d{1,6})\s*:\s*(\d{1,3})\b/g)) {
      const page = Number.parseInt(m[1], 10);
      const lineNo = Number.parseInt(m[2], 10);
      if (
        Number.isFinite(lineNo) &&
        lineNo >= 0 &&
        lineNo <= 35 &&
        Number.isFinite(page) &&
        page >= 1 &&
        page <= 5000
      ) {
        pageLineCandidates.push(page);
      }
    }
  }

  const pl = filterOutliers(pageLineCandidates);
  if (pl.length >= 100 && new Set(pl).size >= 10) {
    const plMax = Math.max(...pl);
    // Cross-check against explicit Page markers if any
    if (pw.length > 0) {
      const pwMax = Math.max(...pw);
      if (plMax > pwMax * 3 || plMax < pwMax * 0.3) {
        return pwMax;
      }
    }
    return plMax;
  }

  // Fallback
  if (pd.length) return Math.max(...pd);
  if (pw.length) return Math.max(...pw);
  return 0;
}

export function chooseTotalTranscriptPages(opts: {
  pdfPageCount: number;
  transcriptMaxPage: number;
}): number {
  const pdf = Math.max(0, opts.pdfPageCount || 0);
  const tr = Math.max(0, opts.transcriptMaxPage || 0);

  if (pdf <= 0) return tr;
  if (tr <= 0) return pdf;
  if (pdf === 1) return 1;
  if (tr === 1 && pdf > 1) return pdf;
  if (Math.abs(tr - pdf) <= 2) return pdf;
  if (tr > pdf && tr < pdf * 1.5) return pdf;
  if (tr > pdf * 6) return pdf;

  const ratio = tr / pdf;
  if (ratio < 0.6) return pdf;

  return tr;
}

function pickRobustMax(nums: number[], pdfPageCount: number): number {
  const filtered = nums.filter((n) => n >= 1 && n <= Math.max(5000, pdfPageCount * 6));
  if (!filtered.length) return 0;

  const counts = new Map<number, number>();
  for (const n of filtered) counts.set(n, (counts.get(n) || 0) + 1);

  const expected = pdfPageCount * 2;
  const frequent = Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .map(([n]) => n);
  const pool = frequent.length ? frequent : Array.from(counts.keys());

  pool.sort((a, b) => {
    const da = Math.abs(a - expected);
    const db = Math.abs(b - expected);
    if (da !== db) return da - db;
    return b - a;
  });

  return pool[0] || 0;
}

// ─── Page Splitting ──────────────────────────────────────────────────────────

export function splitPages(txt: string): { page: number; text: string }[] {
  const explicitMarkers: { lineIndex: number; page: number }[] = [];
  const lines = txt.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^---PAGE\s+(\d+)---$/i);
    if (m) {
      explicitMarkers.push({ lineIndex: i, page: parseInt(m[1], 10) });
    }
  }

  if (explicitMarkers.length > 0) {
    const out: { page: number; text: string }[] = [];
    for (let i = 0; i < explicitMarkers.length; i++) {
      const current = explicitMarkers[i];
      const next = explicitMarkers[i + 1];
      const endLine = next ? next.lineIndex : lines.length;
      const chunkLines = lines.slice(current.lineIndex + 1, endLine);
      out.push({ page: current.page, text: chunkLines.join("\n") });
    }
    return out;
  }

  let currentPage: number | null = null;
  let buf: string[] = [];
  const out: { page: number; text: string }[] = [];

  const push = () => {
    if (buf.length && currentPage != null) {
      out.push({ page: currentPage, text: buf.join("\n") });
    }
    buf = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const normalized = line.replace(/^-+|-+$/g, "").trim();

    const standaloneMatch =
      line.match(/^(?:Page\s*)?(\d{1,5})$/i) ||
      (normalized ? normalized.match(/^(?:Page\s*)?(\d{1,5})$/i) : null);

    if (standaloneMatch) {
      const num = parseInt(standaloneMatch[1], 10);
      const isBareNumber = /^\d+$/.test(normalized || line);
      const isSequential = currentPage === null ? num === 1 : num === currentPage + 1;
      const isExplicitPage = /^Page\s+\d+$/i.test(normalized || line);
      const isReasonableGap = currentPage !== null && num > currentPage && num < currentPage + 10;

      if ((isBareNumber && isSequential) || (!isBareNumber && (isSequential || (isExplicitPage && isReasonableGap)))) {
        push();
        currentPage = num;
        continue;
      }
    }

    const pageLineMatch = line.match(/^(\d{1,5}):\d/);
    if (pageLineMatch) {
      const num = parseInt(pageLineMatch[1], 10);
      if (currentPage === null ? num === 1 : num === currentPage + 1) {
        push();
        currentPage = num;
        continue;
      }
    }

    buf.push(raw);
  }

  push();

  const byPage = new Map<number, string>();
  for (const { page, text } of out) {
    const prev = byPage.get(page) || "";
    if (text.length > prev.length) byPage.set(page, text);
  }

  return Array.from(byPage.entries())
    .map(([page, text]) => ({ page, text }))
    .sort((a, b) => a.page - b.page);
}


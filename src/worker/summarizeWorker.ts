// ─── src/worker/summarizeWorker.ts ────────────────────────────────────────
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import axios from "axios";
import fs from "fs";
import vision from "@google-cloud/vision";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { sendEmail, EmailAttachment } from "../lib/sendEmail";
import { loadPromptConfig } from "../lib/promptConfig";
import pLimit from "p-limit";
import os from "os";
import { resolveFrontendBaseUrl } from "../utils/frontendUrl";
import {
  claimCompletionEmailSend,
  releaseCompletionEmailSend,
} from "../utils/emailDeliveryGuard";
import { loadLightLogo } from "../utils/logo";
import { generateDocxBuffer, generatePdfBuffer } from "../utils/generateDocuments";
import { parseMarkdown } from "../routes/downloadRoutes";
import { renderEmailShell } from "../utils/emailTheme";
import {
  SummaryMetadata,
  renderMetadataMarkdown,
  saveSummaryMetadata,
} from "../utils/summaryMetadata";
import {
  runAllJudges,
  formatJudgeResultsForStorage,
  formatInstructionsForAdmin,
  JudgeContext,
} from "./judges";
import { sendJudgeFailureAlert } from "../utils/adminNotifications";
import { refundCreditsForSummary } from "../routes/billingRoutes";

const prisma = new PrismaClient();
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files");
const summaryBucket = storage.bucket("deposition-summaries");
const visionClient = new vision.ImageAnnotatorClient();

console.log(
  "🔥 summarizeWorker.ts – brand-new build: " + new Date().toISOString()
);
console.log("=== Worker starting ===");

const frontendUrl = resolveFrontendBaseUrl();

// Tuning knobs (env‑overridable)
const DETAIL_MODE = (process.env.SUMMARY_DETAIL_MODE || "high").toLowerCase();
const PAGES_PER_CHUNK = Number(process.env.PAGE_RANGE_SIZE) || (DETAIL_MODE === "high" ? 5 : 6);
const AZURE_MAX_TOKENS = Number(process.env.AZURE_MAX_TOKENS) || (DETAIL_MODE === "high" ? 4000 : 3200);
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1); // Reduced from 3 to 1 to avoid rate limits
const WORKER_ID = process.env.WORKER_ID || os.hostname();
const MAX_EMAIL_BYTES = 24 * 1024 * 1024; // keep email payloads <25MB

async function extractFullText(
  buffer: Buffer,
  filename: string,
  gcsUri: string,
  jobId: string
): Promise<string> {
  const isPDF = filename.toLowerCase().endsWith(".pdf");
  const isDocx = /\.(docx?|DOCX?)$/.test(filename);

  if (isPDF) {
    // Custom render to inject page markers which are critical for robust splitting
    const renderPage = (pageData: any) => {
      const render_options = {
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      };
      return pageData
        .getTextContent(render_options)
        .then(function (textContent: any) {
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
    // Check for meaningful text (not just whitespace/newlines).
    // IMPORTANT: Some PDFs are "mixed": a few text pages + many scanned image pages.
    // In those cases, total non-whitespace can exceed a naive threshold due to headers/footers,
    // but most pages still have near-zero extractable text. Detect that and fall back to Vision.
    const nonWhitespace = trimmed.replace(/\s/g, "").length;
    const pageCount = parsed.numpages || 1;

    // Per-page density check (requires our injected markers).
    const parts = parsed.text.split(/---PAGE\s+\d+---\s*\r?\n/i);
    const pageTexts = parts.length > 1 ? parts.slice(1) : [];
    const pageNonWs = pageTexts.map((t: string) => t.replace(/\s/g, "").length);
    const sparseThreshold = 40; // chars; headers-only pages will be far below this
    const sparseCount = pageNonWs.filter((n: number) => n < sparseThreshold).length;
    const sparseRatio = pageNonWs.length ? sparseCount / pageNonWs.length : 0;
    const avgNonWsPerPage = pageNonWs.length
      ? Math.round(
          pageNonWs.reduce((a: number, b: number) => a + b, 0) / pageNonWs.length
        )
      : Math.round(nonWhitespace / Math.max(1, pageCount));

    // Account for explicit markers in length check (approx overhead per page)
    const markerOverhead = pageCount * 20;

    const looksTextBased =
      nonWhitespace > 100 + markerOverhead &&
      // If most pages are sparse, treat as scanned/mixed.
      !(pageCount >= 10 && (sparseRatio >= 0.6 || avgNonWsPerPage < 80));

    if (looksTextBased) {
      console.log(
        `[${jobId}] PDF text extraction successful: ${trimmed.length} chars (${nonWhitespace} non-whitespace), avg/page≈${avgNonWsPerPage}, sparseRatio=${sparseRatio.toFixed(
          2
        )}`
      );
      return parsed.text;
    }

    console.log(
      `[${jobId}] PDF appears scanned/mixed; using Vision OCR. nonWs=${nonWhitespace}, pages=${pageCount}, avg/page≈${avgNonWsPerPage}, sparseRatio=${sparseRatio.toFixed(
        2
      )}`
    );
    return extractTextWithVision(gcsUri, jobId);
  }

  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  return buffer.toString("utf-8");
}

async function extractTextWithVision(
  gcsUri: string,
  jobId: string,
  opts: { pages?: number[] } = {}
): Promise<string> {
  // Use a unique prefix per invocation so parallel retries or probes don't collide.
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
  // Sort files to ensure page order (output-1-to-1.json, output-2-to-2.json, etc)
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
    // Each response corresponds to a page in the batch (usually batchSize=1 means 1 response per file)
    // But GCS output might chunk differently, so we iterate responses
    for (const r of parsed.responses) {
       const pageText = r.fullTextAnnotation?.text || "";
       combined += `---PAGE ${globalPageIndex}---` + "\n" + pageText + "\n";
       globalPageIndex++;
    }
  }
  // best-effort cleanup of temporary Vision output
  await Promise.all(
    files.map((f) => f.delete().catch(() => {}))
  );
  return combined.trim();
}

export function splitPages(txt: string) {
  // 1. First pass: detect explicit "---PAGE X---" markers (very strong signal)
  const explicitMarkers: { lineIndex: number; page: number }[] = [];
  const lines = txt.split(/\r?\n/);
  
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^---PAGE\s+(\d+)---$/i);
    if (m) {
      explicitMarkers.push({ lineIndex: i, page: parseInt(m[1], 10) });
    }
  }

  // If we have explicit markers covering the document, use them exclusively
  if (explicitMarkers.length > 0) {
    const out: { page: number; text: string }[] = [];
    for (let i = 0; i < explicitMarkers.length; i++) {
      const current = explicitMarkers[i];
      const next = explicitMarkers[i + 1];
      const endLine = next ? next.lineIndex : lines.length;
      
      // Start from the line after the marker
      const chunkLines = lines.slice(current.lineIndex + 1, endLine);
      out.push({
        page: current.page,
        text: chunkLines.join("\n"),
      });
    }
    return out;
  }

  // 2. Fallback: heuristic detection
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

    // Pattern 1: Standalone page number "Page 147" or "147"
    const standaloneMatch =
      line.match(/^(?:Page\s*)?(\d{1,5})$/i) ||
      (normalized ? normalized.match(/^(?:Page\s*)?(\d{1,5})$/i) : null);

    if (standaloneMatch) {
      const num = parseInt(standaloneMatch[1], 10);
      
      // STRICT SEQUENTIALITY CHECK for bare numbers to avoid noise (like "147" in text)
      const isBareNumber = /^\d+$/.test(normalized || line);
      const isSequential = currentPage === null 
        ? num === 1 
        : num === currentPage + 1;
        
      // Allow gaps only if explicit "Page" prefix is present, but not huge gaps
      // AND require bare numbers to be strictly sequential
      const isExplicitPage = /^Page\s+\d+$/i.test(normalized || line);
      const isReasonableGap = currentPage !== null && num > currentPage && num < currentPage + 10;

      if ((isBareNumber && isSequential) || (!isBareNumber && (isSequential || (isExplicitPage && isReasonableGap)))) {
        push();
        currentPage = num;
        continue;
      }
    }
    
    // Pattern 2: Page:Line format (e.g., "147:1-15")
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
  
  // Deduplicate by page number
  const byPage = new Map<number, string>();
  for (const { page, text } of out) {
    const prev = byPage.get(page) || "";
    if (text.length > prev.length) byPage.set(page, text);
  }
  
  return Array.from(byPage.entries())
    .map(([page, text]) => ({ page, text }))
    .sort((a, b) => a.page - b.page);
}

function groupPagesToChunks(
  pages: { page: number; text: string }[],
  perChunk = PAGES_PER_CHUNK // smaller chunks to avoid token limits
) {
  const out: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < pages.length; i += perChunk) {
    const slice = pages.slice(i, i + perChunk);
    out.push({
      start: slice[0].page,
      end: slice[slice.length - 1].page,
      text: slice.map((p) => p.text).join("\n"),
    });
  }
  return out;
}

interface LegalMetadataFields {
  caseCaption: string;
  caseNumber?: string | null;
  deponent: string;
  depositionDate: string;
}

function cleanName(raw: string): string {
  return raw.replace(/[,;].*$/, "").replace(/\b(a|an|the)\s+witness\b/i, "").trim();
}

function looksLikePerson(value: string): boolean {
  const hasNumber = /\d/.test(value);
  if (hasNumber) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  
  // Explicitly blacklist common address/entity terms
  const blacklist = [
    "north", "south", "east", "west",
    "street", "st", "st.", "avenue", "ave", "ave.", "road", "rd", "rd.", "lane", "ln", "ln.",
    "drive", "dr", "dr.", "boulevard", "blvd", "blvd.", "way", "court", "ct", "ct.",
    "plaza", "square", "sq", "sq.", "circle", "cir", "cir.", "floor", "fl", "fl.",
    "suite", "ste", "ste.", "unit", "apt", "apartment", "building", "bldg", "bldg.",
    "ri", "ma", "ct", "ny", "nj", "nh", "vt", "me", "pa", "de", "md", "va", "dc",
    "inc", "inc.", "llc", "l.l.c.", "ltd", "ltd.", "corp", "corp.", "co", "co.",
    "department", "dept", "dept.", "office", "offices", "division", "section",
  ];
  
  const hasBlacklistedWord = words.some(w => blacklist.includes(w.toLowerCase().replace(/[.,]$/, "")));
  if (hasBlacklistedWord) return false;

  return words.every((w) => /^[A-Za-z.'-]+$/.test(w));
}

function extractLegalMetadata(
  tr: string,
  fileData?: { title?: string; deponent?: string }
): LegalMetadataFields {
  const lines = tr.split(/\r?\n/);

  const sliceFirstPages = (raw: string, maxPages: number) => {
    // Prefer explicit page markers (we inject these for both pdf-parse and Vision OCR).
    const parts = raw.split(/---PAGE\s+\d+---\s*\n/i);
    if (parts.length > 1) {
      return parts.slice(1, 1 + Math.max(1, maxPages)).join("\n");
    }
    // Fallback: just take a larger top slice than 300 lines
    return raw.split(/\r?\n/).slice(0, 2500).join("\n");
  };

  // Look at more content: first several pages + a decent line budget catches most cover/index formats.
  const header = sliceFirstPages(tr, 10);

  const civMatch = header.match(
    /(CIVIL\s+ACTION\s+NO\.?|C\.A\.\s*NO\.?|CASE\s*NO\.?)[^\w]*(\w[\w\-\/:]*)/i
  );
  const civil = civMatch?.[2] || "[Unknown]";

  const captionLine =
    lines.slice(0, 40).find((l) => /\b(v\.|vs\.|versus)\b/i.test(l)) || "";
  const caption = captionLine.trim() || `Civil Action No. ${civil}`;

  const deponentMatchers: Array<{ pattern: RegExp; name: string }> = [
    // explicit "Witness" in index
    { pattern: /WITNESS\s+PAGE\s+([A-Z\s\.]+)/i, name: "WITNESS PAGE" },
    { pattern: /WITNESS\s+([A-Z\s\.]+?)\s+PAGE/i, name: "WITNESS...PAGE" },
    { pattern: /WITNESS\s*\n\s*([A-Z\s\.]+)/i, name: "WITNESS newline" },
    // Videotaped/oral deposition variations
    { pattern: /\b(?:VIDEOTAPED|VIDEO)\s+DEPOSITION\s+OF\s+([^\n,]+)/i, name: "VIDEOTAPED DEPOSITION OF" },
    { pattern: /\bORAL\s+DEPOSITION\s+OF\s+([^\n,]+)/i, name: "ORAL DEPOSITION OF" },
    { pattern: /\bEXAMINATION\s+OF\s+([^\n,]+)/i, name: "EXAMINATION OF" },
    // RE: and IN RE: patterns (common in cover pages)
    { pattern: /\bRE:\s*(?:Deposition\s+of\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i, name: "RE:" },
    { pattern: /\bIN\s+RE:\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i, name: "IN RE:" },
    // standard headers
    { pattern: /continued\s+deposition\s+of\s+([^\n,]+)/i, name: "continued deposition of" },
    { pattern: /deposition\s+of\s+([^\n,]+)/i, name: "deposition of" },
    { pattern: /witness:\s*([^\n,]+)/i, name: "witness:" },
    { pattern: /deponent[:\s]+([^\n]+)/i, name: "deponent:" },
    // BEFORE/witness on same page
    { pattern: /\bTHE\s+WITNESS[:\s]+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i, name: "THE WITNESS:" },
  ];
  let extractedDeponent: string | null = null;
  let matchedDeponentPattern: string | null = null;
  for (const { pattern, name } of deponentMatchers) {
    const match = header.match(pattern);
    if (match && match[1]) {
      const candidate = cleanName(match[1]);
      if (candidate && looksLikePerson(candidate)) {
        extractedDeponent = candidate;
        matchedDeponentPattern = name;
        break;
      }
    }
  }
  if (extractedDeponent) {
    console.log(`[DeponentExtraction] Found via "${matchedDeponentPattern}": "${extractedDeponent}"`);
  } else if (fileData?.deponent) {
    console.log(`[DeponentExtraction] Using fileData.deponent: "${fileData.deponent}"`);
  } else {
    console.log(`[DeponentExtraction] No deponent found`);
  }
  const deponent = extractedDeponent || fileData?.deponent || "[Unknown]";

  const normalizeUnknown = (v: string | null) => {
    if (!v) return null;
    const s = v.trim();
    if (!s) return null;
    if (/^\[?\s*unknown\s*\]?$/i.test(s)) return null;
    if (/^\[?\s*n\/a\s*\]?$/i.test(s)) return null;
    return s;
  };

  let extractedDate: string | null = null;
  const extractDateToken = (raw: string): string | null => {
    const s = String(raw || "").trim();
    if (!s) return null;
    // Prefer explicit month-name dates first
    const m1 = s.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+\d{4}\b/i
    );
    if (m1) return m1[0].replace(/(\d)(st|nd|rd|th)\b/i, "$1");
    // Numeric dates
    const m2 = s.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/);
    if (m2) return m2[0];
    // ISO
    const m3 = s.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (m3) return m3[0];
    return null;
  };

  // Special-case: "commencing ... on the 7th day of July, A.D., 2022"
  // Normalize to "July 7, 2022".
  // Handle line breaks and embedded line numbers in transcript text (e.g., "7th day of\n15July")
  const cleanedHeaderForDate = header.replace(/\n\d{1,2}\s*/g, " ").replace(/\s+/g, " ");
  
  // Ordinal date patterns - match various formats:
  // - "on the 7th day of July, A.D., 2022"
  // - "the 7th day of July, 2022"
  // - "7th day of July, A.D., 2022"
  const ordinalDayOfMonth =
    /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(?:A\.?\s*D\.?,?\s*)?(\d{4})\b/i;
  const ordMatch = cleanedHeaderForDate.match(ordinalDayOfMonth);
  if (ordMatch?.[1] && ordMatch?.[2] && ordMatch?.[3]) {
    const day = Number.parseInt(ordMatch[1], 10);
    const month = ordMatch[2];
    const year = ordMatch[3];
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      extractedDate = `${month} ${day}, ${year}`;
      console.log(`[DateExtraction] Found ordinal date: "${extractedDate}"`);
    }
  }

  // Prefer explicit "Date of Deposition" / "Deposition Date" patterns.
  // Also check for "TAKEN" which appears on INDEX pages
  const explicitDatePatterns: Array<{ pattern: RegExp; name: string }> = extractedDate
    ? []
    : [
    // Primary explicit patterns
    { pattern: /\bDate\s+of\s+Deposition\s*[:\-]\s*([^\n\r]+)/i, name: "Date of Deposition" },
    { pattern: /\bDeposition\s+Date\s*[:\-]\s*([^\n\r]+)/i, name: "Deposition Date" },
    { pattern: /\bDate\s+of\s+Examination\s*[:\-]\s*([^\n\r]+)/i, name: "Date of Examination" },
    { pattern: /\bDATE\s+TAKEN\s*[:\-]\s*([^\n\r]+)/i, name: "DATE TAKEN" },
    { pattern: /\bDATED\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "DATED" },
    { pattern: /\bRECORDED\s+(?:ON\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "RECORDED ON" },
    // Date: followed by various formats
    { pattern: /\bDate\s*[:\-]\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i, name: "Date: Month Day, Year" },
    { pattern: /\bDate\s*[:\-]\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "Date: MM/DD/YYYY" },
    { pattern: /\bDate\s*[:\-]\s*(\d{1,2}-\d{1,2}-\d{4})\b/i, name: "Date: MM-DD-YYYY" },
    // Taken on patterns
    { pattern: /\bTaken\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i, name: "Taken on" },
    { pattern: /\bTaken\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "Taken on MM/DD/YYYY" },
    { pattern: /\bTaken\s+on\s+(\d{1,2}-\d{1,2}-\d{4})\b/i, name: "Taken on MM-DD-YYYY" },
    // Held on patterns
    { pattern: /\bHeld\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i, name: "Held on" },
    { pattern: /\bHeld\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "Held on MM/DD/YYYY" },
    { pattern: /\bHeld\s+on\s+(\d{1,2}-\d{1,2}-\d{4})\b/i, name: "Held on MM-DD-YYYY" },
    // INDEX page patterns: "TAKEN July 7, 2022" or "TAKEN: July 7, 2022"
    { pattern: /\bTAKEN[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "TAKEN" },
    { pattern: /\bTAKEN[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "TAKEN MM/DD/YYYY" },
    // Commencing patterns: "commencing July 7, 2022"
    { pattern: /\bcommencing\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "commencing" },
    { pattern: /\bcommencing\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "commencing MM/DD/YYYY" },
    // European format: "7 July 2022" (no comma)
    { pattern: /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i, name: "European Day Month Year" },
  ];
  for (const { pattern, name } of explicitDatePatterns) {
    const match = cleanedHeaderForDate.match(pattern);
    if (match?.[1]) {
      // Handle European format specially (returns 3 groups)
      if (name === "European Day Month Year" && match[2] && match[3]) {
        extractedDate = `${match[2]} ${match[1]}, ${match[3]}`;
        console.log(`[DateExtraction] Found via "${name}": "${extractedDate}"`);
        break;
      }
      const extracted = extractDateToken(match[1]) || match[1].trim();
      if (extracted) {
        extractedDate = extracted;
        console.log(`[DateExtraction] Found via "${name}": "${extractedDate}"`);
        break;
      }
    }
  }

  // Fallback: search for a plausible date near the top of the transcript.
  if (!extractedDate) {
    const topSlice = cleanedHeaderForDate;
    extractedDate = extractDateToken(topSlice);
    if (extractedDate) {
      console.log(`[DateExtraction] Found date via fallback: "${extractedDate}"`);
    }
  }

  const date = normalizeUnknown(extractedDate) || "[Unknown]";
  if (date === "[Unknown]") {
    console.log(`[DateExtraction] No date found in header`);
  }

  return {
    caseCaption: caption,
    caseNumber: civil,
    deponent,
    depositionDate: date,
  };
}

function makePrompt(
  chunk: { start: number; end: number; text: string },
  isFirst: boolean,
  metaSection: string,
  systemInstruction: string
) {
  return [
    {
      role: "system",
      content: systemInstruction,
    },
    {
      role: "user",
      content: isFirst
        ? `
Produce a comprehensive PAGE-LINE deposition summary for pages ${chunk.start}–${chunk.end}.

${metaSection}

CRITICAL COVERAGE REQUIREMENT:
- You MUST cover the entire range from ${chunk.start} through ${chunk.end} with NO GAPS.
- Your rows must progress forward through the range; do not jump around or cherry-pick.
- The union of your page ranges must fully cover ${chunk.start}–${chunk.end}.

OUTPUT FORMAT (STRICT):
- Output ONLY Markdown table rows with EXACTLY two columns: Page(s) | Testimony
- No header row, rows only
- First column MUST use transcript page-line format like: "p.12:1-25, p.13:1-25, p.14:1-10"
- Each row should span 3-5 transcript pages when topics are related (compression), but you must still cover ALL pages in the chunk.
- For each page/section, write 3-6 complete sentences capturing:
  * The main topic or subject matter
  * All specific names, titles, entities, dates, and figures mentioned
  * Document references (exhibits, emails, declarations) with context
  * Key facts, admissions, or statements by the witness
  * Any objections or legal procedural matters
- Be thorough and specific - the attorney should understand the testimony without reading the transcript
- Break into multiple rows when topics change within a page range

Transcript:
${chunk.text}
        `.trim()
        : `
Continue the PAGE-LINE deposition summary for pages ${chunk.start}–${chunk.end}.

Do NOT repeat metadata. Output ONLY additional Markdown table rows with two columns (Page Number | Testimony).
- No header row, rows only
- You MUST cover the entire range from ${chunk.start} through ${chunk.end} with NO GAPS (collectively across your rows)
- First column MUST use transcript page-line format like: "p.12:1-25, p.13:1-25"
- Maintain the same comprehensive, detailed style:
  * 3-6 complete sentences per entry for substantive testimony
  * All specific names, dates, figures, entities
  * Document references with context
  * Key facts and admissions
  * Objections and procedural matters
- Be thorough and specific
- Break into multiple rows when topics change

Transcript:
${chunk.text}
        `.trim(),
    },
  ];
}

async function azureChatCompletion(
  messages: any[],
  maxTokens: number = AZURE_MAX_TOKENS,
  temperature: number = 0.0
) {
  const url = `${process.env.AZURE_OPENAI_ENDPOINT!.replace(
    /\/+$/,
    ""
  )}/openai/deployments/${
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME
  }/chat/completions?api-version=${process.env.AZURE_API_VERSION}`;
  const { data } = await axios.post(
    url,
    { messages, max_tokens: maxTokens, temperature },
    {
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.AZURE_OPENAI_API_KEY!,
      },
      timeout: 120000,
    }
  );
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Generic retry helper (exponential backoff + jitter) for 429/5xx
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; minDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const retries = Math.max(0, opts.retries ?? 3);
  const min = opts.minDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 4000;
  let attempt = 0;
  let lastErr: any;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      const retryable =
        status === 429 || (typeof status === "number" && status >= 500 && status < 600) || !status;
      if (!retryable || attempt === retries) break;
      const backoff = Math.min(
        max,
        Math.floor(min * Math.pow(2, attempt)) + Math.floor(Math.random() * 250)
      );
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr;
}

async function work() {
  while (true) {
    // 1) Find and atomically claim the next queued job
    const candidate = await prisma.summaryJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!candidate) {
      await sleep(10000);
      continue;
    }

    const claimed = await prisma.summaryJob.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: { status: "processing" },
    });
    if (claimed.count === 0) {
      // Raced with another worker; try again.
      continue;
    }

    const job = await prisma.summaryJob.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        fileName: true,
        fileUrl: true,
        notifyOnComplete: true,
        file: { select: { title: true, deponent: true, pages: true } },
      },
    });

    if (!job) {
      console.warn(`[${candidate.id}] Claimed job missing; skipping`);
      continue;
    }

    const displayTitle = job.file?.title || "Untitled Deposition";

    let user;
    try {
      user = await prisma.user.findUnique({ where: { id: job.userId } });
    } catch {
      console.warn(`[${job.id}] Warning: User not found`);
    }

    try {
      const objectKeyFromUrl = (url: string | null | undefined): string | null => {
        if (!url) return null;
        try {
          const u = new URL(url);
          let key = decodeURIComponent(u.pathname.replace(/^\//, ""));
          // Support both URL styles:
          // - https://storage.googleapis.com/<bucket>/<object>
          // - https://<bucket>.storage.googleapis.com/<object>
          if (key.startsWith(`${depositionBucket.name}/`)) {
            key = key.slice(depositionBucket.name.length + 1);
          }
          return key || null;
        } catch {
          return null;
        }
      };
      const depositionObjectKey = objectKeyFromUrl(job.fileUrl) || job.fileName;
      const [buf] = await depositionBucket.file(depositionObjectKey).download();
      const gcsUri = `gs://${depositionBucket.name}/${depositionObjectKey}`;
      const transcript = await extractFullText(buf, job.fileName, gcsUri, job.id);
      const pages = splitPages(transcript);
      const pdfPageCount = pages.length;
      let transcriptMaxPage = detectTranscriptMaxPage(transcript);
      console.log(`[${job.id}] Page count detection: pdfPageCount=${pdfPageCount}, transcriptMaxPage=${transcriptMaxPage}`);
      const filePagesHintRaw = job.file?.pages;
      const filePagesHint =
        typeof filePagesHintRaw === "number" && Number.isFinite(filePagesHintRaw) && filePagesHintRaw > 0
          ? filePagesHintRaw
          : null;

      const debugJobId = process.env.DEBUG_SUMMARY_JOB_ID;
      const debugThisJob = debugJobId && debugJobId === job.id;
      // If we couldn't detect internal transcript page numbering from extracted text,
      // run a cheap Vision OCR probe on the last few *PDF* pages to recover "Page X of Y"/page-line headers.
      if (!transcriptMaxPage || transcriptMaxPage <= 0) {
        try {
          const tailPages = Array.from({ length: 8 }, (_, i) => pdfPageCount - i).filter((n) => n >= 1);
          const ocrTail = await extractTextWithVision(gcsUri, `${job.id}-pagecount`, { pages: tailPages });

          // Collect candidate page numbers from OCR and choose a robust max.
          // Multi-up transcripts often have ~2 transcript pages per PDF page.
          const candidates: number[] = [];
          for (const m of ocrTail.matchAll(/\b(?:Page|Pg\.?)\s+(\d{1,6})\b/gi)) {
            const n = Number.parseInt(m[1], 10);
            if (Number.isFinite(n) && n >= 1 && n <= 5000) candidates.push(n);
          }
          // Also consider p.X tokens
          for (const m of ocrTail.matchAll(/\bp\.\s*(\d{1,6})(?:\b|:)/gi)) {
            const n = Number.parseInt(m[1], 10);
            if (Number.isFinite(n) && n >= 1 && n <= 5000) candidates.push(n);
          }

          const pickRobustMax = (nums: number[]) => {
            const filtered = nums.filter((n) => n >= 1 && n <= Math.max(5000, pdfPageCount * 6));
            if (!filtered.length) return 0;
            const counts = new Map<number, number>();
            for (const n of filtered) counts.set(n, (counts.get(n) || 0) + 1);
            const expected = pdfPageCount * 2; // multi-up heuristic
            const frequent = Array.from(counts.entries())
              .filter(([, c]) => c >= 2)
              .map(([n]) => n);
            const pool = frequent.length ? frequent : Array.from(counts.keys());
            pool.sort((a, b) => {
              const da = Math.abs(a - expected);
              const db = Math.abs(b - expected);
              if (da !== db) return da - db; // closer to expected first
              return b - a; // then prefer larger
            });
            return pool[0] || 0;
          };

          const ocrGuess = pickRobustMax(candidates);
          if (ocrGuess && ocrGuess > 0) transcriptMaxPage = ocrGuess;
        } catch (e) {
          console.warn(`[${job.id}] Vision page-count probe failed; continuing without it`);
        }
      }

      const totalTranscriptPages =
        // Only trust File.pages as a hint when it matches the PDF page count (single-page-per-page transcripts).
        // This prevents poisoned DB values from forcing wrong totals.
        filePagesHint && Math.abs(filePagesHint - pdfPageCount) <= 2
          ? filePagesHint
          : chooseTotalTranscriptPages({
              pdfPageCount,
              transcriptMaxPage,
            });

      console.log(`[${job.id}] Final page count: totalTranscriptPages=${totalTranscriptPages}, filePagesHint=${filePagesHint}`);

      if (debugThisJob) {
        const lens = pages.map((p) => (p.text || "").replace(/\s/g, "").length);
        const emptyCount = lens.filter((n) => n < 40).length;
        const avg = lens.length
          ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)
          : 0;
        console.log(
          `[${job.id}] DEBUG page stats: pdfPageCount=${pdfPageCount}, transcriptMaxPage=${transcriptMaxPage}, totalTranscriptPages=${totalTranscriptPages}, avgNonWsPerPage≈${avg}, emptyRatio=${(
            emptyCount / Math.max(1, lens.length)
          ).toFixed(2)}`
        );
      }

      const chunks = groupPagesToChunks(pages);
      let legalMeta = extractLegalMetadata(transcript, {
        title: job.file?.title,
        deponent: job.file?.deponent || undefined,
      });
      // If deposition date wasn't extractable from text (common when cover page is an image),
      // run a small Vision probe on the first few PDF pages to recover it.
      if (!legalMeta.depositionDate || /^\[?\s*unknown\s*\]?$/i.test(legalMeta.depositionDate)) {
        try {
          const headPages = [1, 2, 3].filter((n) => n <= pdfPageCount);
          const ocrHead = await extractTextWithVision(gcsUri, `${job.id}-metadata`, { pages: headPages });
          const probed = extractLegalMetadata(`${ocrHead}\n${transcript}`, {
            title: job.file?.title,
            deponent: job.file?.deponent || undefined,
          });
          // Keep any already-good fields, but adopt probed depositionDate if it improves.
          if (
            probed.depositionDate &&
            !/^\[?\s*unknown\s*\]?$/i.test(probed.depositionDate)
          ) {
            legalMeta = { ...legalMeta, depositionDate: probed.depositionDate };
          }
          if (
            (!legalMeta.deponent || /^\[?\s*unknown\s*\]?$/i.test(legalMeta.deponent)) &&
            probed.deponent &&
            !/^\[?\s*unknown\s*\]?$/i.test(probed.deponent)
          ) {
            legalMeta = { ...legalMeta, deponent: probed.deponent };
          }
        } catch (e) {
          console.warn(`[${job.id}] Vision metadata probe failed; continuing without it`);
        }
      }
      const metadata: SummaryMetadata = {
        jobId: job.id,
        caseCaption: legalMeta.caseCaption,
        caseNumber: legalMeta.caseNumber,
        caseTitle: job.file?.title || displayTitle,
        deponent: legalMeta.deponent,
        depositionDate: legalMeta.depositionDate,
        sourceFileName: job.fileName,
        totalPages: totalTranscriptPages,
        uploadDate: (job.createdAt || new Date()).toISOString(),
      };
      await saveSummaryMetadata(summaryBucket, metadata);
      const metaMarkdown = renderMetadataMarkdown(metadata);

      // Persist totalPages early for better UI progress feedback
      try {
        const pageCount = totalTranscriptPages;
        if (pageCount > 0) {
          await prisma.summaryJob.update({
            where: { id: job.id },
            data: { totalPages: pageCount },
          });
          // IMPORTANT: Do NOT overwrite File.pages here. File.pages is a file-level property (often PDF page count)
          // and can be "poisoned" by false-positive transcript max-page detection. Only set it at upload time.
        }
      } catch {}

      // 2) Summarize chunks with bounded parallelism and retries
      const limit = pLimit(WORKER_CONCURRENCY);
      const parts: string[] = new Array(chunks.length).fill("");

      await Promise.all(
        chunks.map((chunk, i) =>
          limit(async () => {
            const resp = await withRetry(
              () => {
                const cfg = loadPromptConfig();
                return azureChatCompletion(
                  makePrompt(chunk, i === 0, metaMarkdown, cfg.system),
                  typeof cfg.maxTokens === "number" ? cfg.maxTokens : AZURE_MAX_TOKENS,
                  typeof cfg.temperature === "number" ? cfg.temperature : 0.0
                );
              },
              { retries: 5, minDelayMs: 2000, maxDelayMs: 30000 } // Increased retries and delays for rate limits
            );
            const content = String(resp?.choices?.[0]?.message?.content || "").trim();
            parts[i] = content;
            if (process.env.DEBUG_SUMMARY_JOB_ID === job.id) {
              const lines = content.split(/\r?\n/);
              const rowish = lines.filter((l) => /^\s*\|?\s*p\.\s*\d+/i.test(l)).length;
              console.log(
                `[${job.id}] DEBUG chunk ${i + 1}/${chunks.length} pdfPages ${chunk.start}-${chunk.end}: chars=${content.length}, rowishLines=${rowish}`
              );
            }
            // Best-effort progress update - cap at total pages
            const cappedPage = Math.min(
              totalTranscriptPages,
              Math.max(
                1,
                Math.round(
                  (chunk.end / Math.max(1, pdfPageCount)) * totalTranscriptPages
                )
              )
            );
            await prisma.summaryJob.update({
              where: { id: job.id },
              data: { lastPageProcessed: cappedPage },
            });
          })
        )
      );

      const mergedRaw = parts.join("\n");
      const rowsOnlyUnbounded = sanitizeGeneratedMarkdown(mergedRaw)
        .replace(/```[\s\S]*?```/g, "")
        .trim();
      const rowsOnly = trimOutOfRangeRows(rowsOnlyUnbounded, totalTranscriptPages);

      // Parse summary rows for judge validation
      const summaryRows = parseSummaryRows(rowsOnly);

      // Run judge agents to validate output
      const judgeContext: JudgeContext = {
        jobId: job.id,
        pdfPageCount,
        transcriptMaxPage,
        totalPages: totalTranscriptPages,
        deponent: legalMeta.deponent,
        depositionDate: legalMeta.depositionDate,
        caseCaption: legalMeta.caseCaption,
        summaryRows,
      };

      const judgeResults = await runAllJudges(judgeContext);

      // Update metadata with judge results
      const metadataWithJudges: SummaryMetadata = {
        ...metadata,
        judgeResults: formatJudgeResultsForStorage(judgeResults),
      };
      await saveSummaryMetadata(summaryBucket, metadataWithJudges);

      // Log warnings and send admin alert if any judge failed
      if (!judgeResults.allPassed) {
        console.warn(
          `[${job.id}] ⚠️ Judge validation found issues:\n${formatInstructionsForAdmin(judgeResults)}`
        );
        // Send async admin notification (don't await to avoid blocking)
        sendJudgeFailureAlert(job.id, formatJudgeResultsForStorage(judgeResults)).catch((e: any) =>
          console.warn(`[${job.id}] Failed to send admin alert: ${e?.message || e}`)
        );
      }

      const merged = [metaMarkdown, "", rowsOnly].join("\n\n");
      const tmpPath = `/tmp/${job.id}.md`;
      fs.writeFileSync(tmpPath, merged);

      const dest = `summary-${job.id}.md`;
      await summaryBucket.upload(tmpPath, {
        destination: dest,
        contentType: "text/markdown",
      });

      const [signedUrl] = await summaryBucket.file(dest).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 3 * 86400000,
      });

      await prisma.summaryJob.update({
        where: { id: job.id },
        data: {
          status: "complete",
          summaryCsvUrl: signedUrl,
          lastPageProcessed: totalTranscriptPages,
          totalPages: totalTranscriptPages,
          finishedAt: new Date(),
        },
      });

      // Re-fetch notifyOnComplete at completion time to honor late opt-ins
      const fresh = await prisma.summaryJob.findUnique({
        where: { id: job.id },
        select: { notifyOnComplete: true },
      });
      if (fresh?.notifyOnComplete && user?.email) {
        const claimed = await claimCompletionEmailSend(prisma, job.id);
        if (!claimed) {
          console.log(
            `[${job.id}] 📧 Completion email already sent, skipping worker delivery`
          );
        } else {
          console.log(
            `[${job.id}] 📧 Attempting to send email to ${user.email}`
          );
          const dashboardUrl = `${frontendUrl}/summaries`;
          try {
            const attachments: EmailAttachment[] = [];
            try {
              console.log(`[${job.id}] 📄 Generating DOCX and PDF attachments...`);
              const { rows } = parseMarkdown(merged);
              const filePages =
                typeof job.file?.pages === "number" && !Number.isNaN(job.file.pages)
                  ? String(job.file.pages)
                  : null;
              const jobData = {
                id: job.id,
                fileName: job.fileName,
                createdAt: job.createdAt,
                file: job.file
                  ? {
                      title: job.file.title,
                      deponent: job.file.deponent,
                      pages: filePages,
                    }
                  : null,
              };
              const safeTitle =
                displayTitle
                  .replace(/[^a-z0-9_.-]+/gi, "-")
                  .replace(/-+/g, "-")
                  .replace(/^-|-$/g, "") || "summary";
              const docxBuffer = await generateDocxBuffer(
                jobData,
                metadata,
                { meta: metaMarkdown.split("\n"), rows },
                merged
              );
              const pdfBuffer = await generatePdfBuffer(
                jobData,
                metadata,
                { meta: metaMarkdown.split("\n"), rows },
                merged
              );
              const totalBytes = docxBuffer.length + pdfBuffer.length;
              if (totalBytes > MAX_EMAIL_BYTES) {
                console.warn(
                  `[${job.id}] ⚠️ Attachments too large (${totalBytes} bytes). Sending email without attachments.`
                );
              } else {
                attachments.push({
                  content: docxBuffer.toString("base64"),
                  filename: `${safeTitle}.docx`,
                  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                });
                attachments.push({
                  content: pdfBuffer.toString("base64"),
                  filename: `${safeTitle}.pdf`,
                  type: "application/pdf",
                });
              }
            } catch (docErr) {
              console.warn(
                `[${job.id}] ⚠️ Failed to generate document attachments:`,
                docErr
              );
            }

            const logoLight = loadLightLogo();
            const logoCid = "logo_light@testifi.ai";
            const inlineLogo: EmailAttachment = {
              content: logoLight.base64,
              filename: "logo-light.png",
              type: logoLight.mime,
              disposition: "inline",
              contentId: logoCid,
            };

            const subject = `Your Deposition Summary Is Ready`;
            const userName = user.name || user.email;
            const attachmentsNote = attachments.length
              ? `<p style="text-align: center;">Your summary is attached to this email in Word (DOCX) and PDF formats.</p>`
              : "";
            const ctaWrapStyle = "text-align:center;margin:28px 0;";
            const ctaButtonStyle =
              "display:inline-block;padding:12px 24px;background-color:#5674BC;color:#ffffff !important;text-decoration:none;border-radius:6px;font-weight:600;";
            const retentionStyle =
              "margin-top:24px;padding:16px;background-color:#fff3cd;border:1px solid #ffe58f;border-left:4px solid #ffc107;border-radius:6px;color:#5c3d00;";
            const retentionHeadingStyle =
              "margin:0 0 8px 0;color:#5c3d00;font-weight:600;";
            const retentionBodyStyle = "margin:0;color:#5c3d00;";

            const bodyHtml = `
              <h2>Your Deposition Summary Is Ready</h2>
              <p>Hello ${userName},</p>
              <p>Great news — the summary you requested for <strong>${displayTitle}</strong> is now complete. Click the button below to return to your dashboard and review it for the next 3 days. The summary will be automatically deleted after 3 days.</p>
              <div class="cta-wrap" style="${ctaWrapStyle}">
                <a href="${dashboardUrl}" class="btn" style="${ctaButtonStyle}">View on Dashboard</a>
              </div>
              ${attachmentsNote}
              <div class="notice" style="${retentionStyle}">
                <p style="${retentionHeadingStyle}"><strong>Important:</strong> Summary Retention Policy</p>
                <p style="${retentionBodyStyle}">Summaries older than 3 days will be automatically deleted from the platform and the content will be irretrievable. Please download and save your summary files for your records.</p>
              </div>
              <p>Need help or have questions? Reply to this email and our support team will be happy to assist.</p>
            `;
            const html = renderEmailShell({
              title: "Deposition Summary Ready",
              bodyHtml,
              theme: (process.env.EMAIL_THEME as any) || "auto",
              logoCid,
            });

            const text = `Hello ${userName},

Great news — the summary you requested for ${displayTitle} is now complete. Visit ${dashboardUrl} to review it during the next 3 days before it is automatically deleted.

${attachments.length ? "Your summary is attached to this email in Word (DOCX) and PDF formats.\n\n" : ""}Important: Summary Retention Policy
Summaries older than 3 days will be automatically deleted from the platform and the content will be irretrievable. Please download and save your summary files for your records.

Need help or have questions? Reply to this email and our support team will be happy to assist.

© ${new Date().getFullYear()} Testifi AI. All rights reserved.
You're receiving this because you have an account on Testifi AI.`;

            const allAttachments = [inlineLogo, ...attachments];
            await sendEmail(user.email, subject, text, html, allAttachments);
            console.log(
              `[${job.id}] 📬 Email sent to ${user.email}${
                attachments.length ? ` with ${attachments.length} attachment(s)` : ""
              }`
            );
          } catch (emailErr) {
            await releaseCompletionEmailSend(prisma, job.id);
            console.warn(`[${job.id}] Email failed:`, emailErr);
          }
        }
      } else {
        console.log(
          `[${job.id}] ℹ️ Skipping email notification (notifyOnComplete: ${fresh?.notifyOnComplete}, email: ${user?.email})`
        );
      }

      fs.unlinkSync(tmpPath);
      console.log(`[${job.id}] ✅ Summary completed by ${WORKER_ID}.`);
    } catch (e: any) {
      console.error(`[${job.id}] ❌ Error:`, e);
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { status: "error", error: e.message || "Unknown error" },
      });

      // Refund credits for failed job
      try {
        await refundCreditsForSummary(job.userId, job.id);
        console.log(`[${job.id}] 💰 Refunded credit for failed job`);
      } catch (refundError: any) {
        console.error(`[${job.id}] Failed to refund credit:`, refundError?.message || refundError);
      }
    }
  }
}

// Parse summary markdown rows into structured format for judge validation
function parseSummaryRows(md: string): Array<{ pageLabel: string; summary: string }> {
  const rows: Array<{ pageLabel: string; summary: string }> = [];
  const lines = md.split(/\r?\n/);

  for (const line of lines) {
    // Skip header/separator lines
    if (/^\s*\|?\s*-+/.test(line)) continue;
    if (/^\s*\|?\s*Page\s*\(?s?\)?\s*\|/i.test(line)) continue;

    // Parse table row: | page | summary | or page | summary
    const stripped = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const parts = stripped.split("|");

    if (parts.length >= 2) {
      const pageLabel = parts[0].trim();
      const summary = parts.slice(1).join("|").trim();

      // Validate page label looks like a page reference
      if (/^(?:p(?:age)?\.?\s*)?\d{1,6}/i.test(pageLabel) && summary) {
        rows.push({ pageLabel, summary });
      }
    }
  }

  return rows;
}

// Remove model filler like "To be continued..." or "Let me know if you'd like me to continue"
function sanitizeGeneratedMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const banned = [
    /\bto be continued\b/i,
    /\blet me know if you'd like me to continue\b/i,
    /\blet me know if you(?:'|\s)\w* like me to continue\b/i,
    /\bprovide further clarification\b/i,
    /\bcan continue summarizing\b/i,
  ];

  const extractFirstPageNumber = (rawLine: string): number | null => {
    // Support common row formats:
    // - "p.66:2-25 | ..."
    // - "66 | ..."
    // - "| 66 | ... |"
    // - "Page 66 | ..."
    const line = rawLine.trim().replace(/^\|+/, "").trim();
    const m = line.match(/^(?:p(?:age)?\.?\s*)?(\d{1,5})\b/i);
    if (!m) return null;
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  };

  const keep: string[] = [];
  const seen = new Set<string>();
  let maxPageSeen = 0;
  let sawSubstantialProgress = false;

  for (const l of lines) {
    if (banned.some((re) => re.test(l))) continue;

    const pageNum = extractFirstPageNumber(l);
    if (pageNum != null) {
      // Once we've progressed into a meaningful page range, a big backward jump
      // is almost always the model accidentally repeating earlier rows.
      if (maxPageSeen >= 20) sawSubstantialProgress = true;
      if (sawSubstantialProgress && pageNum <= maxPageSeen - 5) {
        // Skip likely repeated/hallucinated row but keep processing.
        continue;
      }
      maxPageSeen = Math.max(maxPageSeen, pageNum);
    }

    const key = l.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(l);
  }

  return keep.join("\n");
}

function trimOutOfRangeRows(mdRows: string, maxPage: number): string {
  if (!maxPage || maxPage <= 0) return mdRows;
  const lines = mdRows.split(/\r?\n/);
  const out: string[] = [];
  let sawValid = false;
  let invalidStreak = 0;

  const extractPagesFromLabel = (rawLine: string): number[] => {
    // Only treat lines as "rows" if they *start* with a page label.
    // This avoids accidentally parsing years, exhibit numbers, dollar amounts, etc. in testimony text.
    const stripped = rawLine.trim().replace(/^\|+/, "").trim();
    const label = stripped.split("|")[0]?.trim() || "";
    if (!/^(?:p(?:age)?\.?\s*)?\d{1,6}\b/i.test(label)) return [];

    const re = /(?:^|[,\s])(?:p(?:age)?\.?)?\s*(\d{1,6})\b/gi;
    const pages: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(label))) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n)) pages.push(n);
    }
    return pages;
  };

  for (const l of lines) {
    const pages = extractPagesFromLabel(l);
    if (!pages.length) {
      out.push(l);
      continue;
    }
    const invalid = pages.some((p) => p < 1 || p > maxPage);
    if (invalid) {
      if (!sawValid) continue; // drop leading p.0 etc
      // Be tolerant: a single hallucinated/out-of-range row shouldn't wipe the whole summary.
      // Only truncate if we see a sustained run of invalid rows (typical hallucinated tail).
      invalidStreak++;
      if (invalidStreak >= 10) break;
      continue;
    }
    sawValid = true;
    invalidStreak = 0;
    out.push(l);
  }
  return out.join("\n").trim();
}

function detectTranscriptMaxPage(transcript: string): number {
  // We want the *transcript* page count, not the PDF scan page count.
  // Many scanned depositions contain multiple transcript pages per PDF page and include markers like '(Pages 2 - 5)'.
  // Heuristics (in priority order):
  // - '(Pages X - Y)' ranges (HIGHEST priority - very reliable)
  // - 'Page X' tokens
  // - 'X:Y' page:line tokens (strictly filtered: line <= 35, page <= 5000)
  // - Ignore our injected markers like '---PAGE 12---'
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
    // Allow large transcripts but cut extreme OCR/ID noise.
    const cap = Math.max(1000, Math.round(med * 10));
    return nums.filter((n) => n >= 1 && n <= 5000 && n <= cap);
  };

  // To reduce false positives (e.g. dollar amounts / years / exhibit numbers in body),
  // scan line-by-line and only accept strong page markers that usually appear as standalone headers/footers.
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  
  // Detect if we're in a word index section (common at end of transcripts)
  // Word indices have patterns like "word 265:3, 266:5" which are false positives
  let inIndexSection = false;
  const indexStartPatterns = [
    /^\s*INDEX\s*$/i,
    /^\s*WORD\s+INDEX\s*$/i,
    /^\s*ALPHABETICAL\s+INDEX\s*$/i,
  ];
  
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    const line = raw.trim();
    if (!line) continue;
    
    // Check if we're entering an index section
    if (indexStartPatterns.some((p) => p.test(line))) {
      inIndexSection = true;
      continue;
    }

    // '(Pages 2 - 5)' sometimes appears in certification/footer blocks.
    // This is the MOST reliable indicator - use it exclusively if found.
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

    // 'Page 239' as a standalone line
    const pageWord = line.match(/^(?:Page|Pg\.?)\s+(\d{1,6})$/i);
    if (pageWord) {
      const n = Number.parseInt(pageWord[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pageWordCandidates.push(n);
      continue;
    }
    // Also accept common header/footer forms like "Page 239 of 239" or "Page 239/239"
    const pageInline = line.match(/\b(?:Page|Pg\.?)\s+(\d{1,6})\b/i);
    if (pageInline && (/\bof\b/i.test(line) || /\//.test(line) || line.length <= 32)) {
      const n = Number.parseInt(pageInline[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pageWordCandidates.push(n);
      continue;
    }

    // 'p.239' or 'p.239:1-25' at the start of a line
    const pDot = line.match(/^p\.\s*(\d{1,6})(?:\b|:)/i);
    if (pDot) {
      const n = Number.parseInt(pDot[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pDotCandidates.push(n);
      continue;
    }
    // Also accept inline "p.239" tokens when they look like headers/labels
    const pDotInline = line.match(/\bp\.\s*(\d{1,6})(?:\b|:)/i);
    if (pDotInline && line.length <= 40) {
      const n = Number.parseInt(pDotInline[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) pDotCandidates.push(n);
      continue;
    }

    // '239:3' at the start of a line (page:line)
    // SKIP if we're in an index section (word indices have false positives)
    // SKIP if we're in the last 20% of the transcript (likely index/appendix area)
    const isInTailSection = lineIdx > totalLines * 0.8;
    
    if (!inIndexSection && !isInTailSection) {
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
  }

  // PRIORITY 0: If we found a (Pages X - Y) range, use it exclusively.
  // This is the most reliable indicator of actual page count.
  if (maxFromRange > 0 && maxFromRange <= 5000) {
    console.log(`[PageCount] Using (Pages X-Y) range: ${maxFromRange}`);
    return maxFromRange;
  }

  // PRIORITY 0.5: "Page X of Y" format - Y is the total, very reliable
  if (maxFromPageOfY > 0 && maxFromPageOfY <= 5000) {
    console.log(`[PageCount] Using "Page X of Y" total: ${maxFromPageOfY}`);
    return maxFromPageOfY;
  }

  // PRIORITY 1: Explicit "Page X" or "Pg. X" markers are most reliable.
  // These are unambiguous page markers found in headers/footers.
  const pw = filterOutliers(pageWordCandidates);
  if (pw.length >= 10) {
    // Strong signal: many explicit Page markers
    const result = Math.max(...pw);
    console.log(`[PageCount] Using Page/Pg markers (${pw.length} found): ${result}`);
    return result;
  }

  // PRIORITY 2: "p.X" notation (common in legal citations)
  const pd = filterOutliers(pDotCandidates);
  if (pd.length >= 5) {
    const result = Math.max(...pd);
    console.log(`[PageCount] Using p.X notation (${pd.length} found): ${result}`);
    return result;
  }

  // PRIORITY 3: Page:line patterns (X:Y format) - use only as fallback
  // These can match noise like phone numbers, times, etc., so require strong evidence
  // and cross-check against explicit markers if any exist
  // NOTE: Only collect from the first 80% of text to avoid index false positives
  if (pageLineCandidates.length < 100) {
    const textLines = text.split(/\r?\n/);
    const cutoff = Math.floor(textLines.length * 0.8);
    const mainBodyText = textLines.slice(0, cutoff).join("\n");
    
    for (const m of mainBodyText.matchAll(/\b(\d{1,6})\s*:\s*(\d{1,3})\b/g)) {
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

  const plFiltered = filterOutliers(pageLineCandidates);
  if (plFiltered.length >= 100 && new Set(plFiltered).size >= 10) {
    const plMax = Math.max(...plFiltered);
    // If we have even a few explicit Page markers, use them to sanity-check
    if (pw.length > 0) {
      const pwMax = Math.max(...pw);
      // If page:line max is wildly different from Page markers, prefer Page markers
      if (plMax > pwMax * 3 || plMax < pwMax * 0.3) {
        console.log(`[PageCount] Page:line max ${plMax} differs from Page markers ${pwMax}, using Page markers`);
        return pwMax;
      }
    }
    console.log(`[PageCount] Using page:line patterns (${plFiltered.length} found): ${plMax}`);
    return plMax;
  }

  // Fallback: use whatever explicit markers we have
  if (pd.length) {
    const result = Math.max(...pd);
    console.log(`[PageCount] Fallback to p.X notation: ${result}`);
    return result;
  }
  if (pw.length) {
    const result = Math.max(...pw);
    console.log(`[PageCount] Fallback to Page markers: ${result}`);
    return result;
  }
  console.log(`[PageCount] No reliable page count found`);
  return 0;
}

function chooseTotalTranscriptPages(opts: {
  pdfPageCount: number;
  transcriptMaxPage: number;
}): number {
  const pdf = Math.max(0, opts.pdfPageCount || 0);
  const tr = Math.max(0, opts.transcriptMaxPage || 0);

  if (pdf <= 0) return tr;
  if (tr <= 0) return pdf;

  // If it's a single-page PDF, just trust the PDF.
  if (pdf === 1) return 1;

  // If transcript numbering looks like a trivial "Page 1" match across a multi-page PDF, ignore it.
  if (tr === 1 && pdf > 1) return pdf;

  // If it's effectively 1:1, use the PDF count.
  if (Math.abs(tr - pdf) <= 2) return pdf;

  // If transcript count is only modestly larger than the PDF (e.g. +10-20%),
  // it's usually a false-positive rather than true multi-up transcript pages.
  // Real multi-up transcripts are typically 2x–4x+.
  if (tr > pdf && tr < pdf * 1.5) return pdf;

  // Sanity cap: if "transcript max page" is wildly larger than the PDF page count,
  // it's almost always a false positive from OCR noise (e.g. IDs like 606062:1).
  // True multi-up transcripts are rarely >4x; allow up to 6x to be safe.
  if (tr > pdf * 6) return pdf;

  // If transcript numbering is implausibly small compared to the PDF, it's likely a false positive.
  const ratio = tr / pdf;
  if (ratio < 0.6) return pdf;

  // Otherwise, prefer transcript page numbering (covers multi-per-page scans and PDFs with extra non-transcript pages).
  return tr;
}

work().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

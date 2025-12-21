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
    // Check for meaningful text (not just whitespace/newlines)
    const nonWhitespace = trimmed.replace(/\s/g, "").length;
    // Account for explicit markers in length check (approx 15 chars per page)
    const markerOverhead = (parsed.numpages || 1) * 20;
    
    if (nonWhitespace > 100 + markerOverhead) {
      console.log(
        `[${jobId}] PDF text extraction successful: ${trimmed.length} chars (${nonWhitespace} non-whitespace)`
      );
      return parsed.text;
    }
    console.log(
      `[${jobId}] PDF appears to be scanned/image-based (only ${nonWhitespace} chars), using Vision API...`
    );
    return extractTextWithVision(gcsUri, jobId);
  }

  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  return buffer.toString("utf-8");
}

async function extractTextWithVision(gcsUri: string, jobId: string): Promise<string> {
  const destinationUri = `gs://${summaryBucket.name}/vision-output/${jobId}/`;
  const [operation] = await visionClient.asyncBatchAnnotateFiles({
    requests: [
      {
        inputConfig: {
          gcsSource: { uri: gcsUri },
          mimeType: "application/pdf",
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        outputConfig: { gcsDestination: { uri: destinationUri }, batchSize: 1 },
      },
    ],
  });
  await operation.promise();
  const [files] = await summaryBucket.getFiles({
    prefix: `vision-output/${jobId}/`,
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

  const deponentMatchers = [
    // explicit "Witness" in index
    /WITNESS\s+PAGE\s+([A-Z\s\.]+)/i,
    /WITNESS\s+([A-Z\s\.]+?)\s+PAGE/i,
    /WITNESS\s*\n\s*([A-Z\s\.]+)/i,
    // standard headers
    /continued\s+deposition\s+of\s+([^\n,]+)/i,
    /deposition\s+of\s+([^\n,]+)/i,
    /witness:\s*([^\n,]+)/i,
    /deponent[:\s]+([^\n]+)/i,
  ];
  let extractedDeponent: string | null = null;
  for (const pattern of deponentMatchers) {
    const match = header.match(pattern);
    if (match && match[1]) {
      const candidate = cleanName(match[1]);
      if (candidate && looksLikePerson(candidate)) {
        extractedDeponent = candidate;
        break;
      }
    }
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

  // Special-case: "commencing ... on the 7th day of July, A.D., 2022"
  // Normalize to "July 7, 2022".
  const ordinalDayOfMonth =
    /\b(?:on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(?:A\.D\.,?\s*)?(\d{4})\b/i;
  const ordMatch = header.match(ordinalDayOfMonth);
  if (ordMatch?.[1] && ordMatch?.[2] && ordMatch?.[3]) {
    const day = Number.parseInt(ordMatch[1], 10);
    const month = ordMatch[2];
    const year = ordMatch[3];
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      extractedDate = `${month} ${day}, ${year}`;
    }
  }

  // Prefer explicit "Date of Deposition" / "Deposition Date" patterns.
  const explicitDatePatterns = extractedDate
    ? []
    : [
    /\bDate\s+of\s+Deposition\s*[:\-]\s*([^\n\r]+)/i,
    /\bDeposition\s+Date\s*[:\-]\s*([^\n\r]+)/i,
    /\bDate\s*[:\-]\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i,
    /\bDate\s*[:\-]\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i,
    /\bTaken\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i,
    /\bTaken\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i,
    /\bHeld\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i,
    /\bHeld\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i,
  ];
  for (const pattern of explicitDatePatterns) {
    const match = header.match(pattern);
    if (match?.[1]) {
      extractedDate = match[1].trim();
      break;
    }
  }

  // Fallback: search for a plausible date near the top of the transcript.
  if (!extractedDate) {
    const dateRegex =
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i;
    const topSlice = header;
    extractedDate =
      topSlice.match(dateRegex)?.[0] ||
      topSlice.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0] ||
      topSlice.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ||
      null;
  }

  const date = normalizeUnknown(extractedDate) || "[Unknown]";

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

Output ONLY Markdown table rows with EXACTLY two columns: Page Number | Testimony.
- No header row, rows only
- Use page ranges (e.g., "12", "12-13", "15-16") in the first column
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
- Use page ranges in the first column
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
      const [buf] = await depositionBucket.file(job.fileName).download();
      const gcsUri = `gs://${depositionBucket.name}/${job.fileName}`;
      const transcript = await extractFullText(buf, job.fileName, gcsUri, job.id);
      const pages = splitPages(transcript);
      const pdfPageCount = pages.length;
      const transcriptMaxPage = detectTranscriptMaxPage(transcript);
      const totalTranscriptPages = chooseTotalTranscriptPages({
        pdfPageCount,
        transcriptMaxPage,
      });
      const chunks = groupPagesToChunks(pages);
      const legalMeta = extractLegalMetadata(transcript, {
        title: job.file?.title,
        deponent: job.file?.deponent || undefined,
      });
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
          // Also update File.pages for consistent display throughout UI
          await prisma.file.updateMany({
            where: { fileName: job.fileName, userId: job.userId },
            data: { pages: pageCount },
          });
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
            parts[i] = resp.choices[0].message.content.trim();
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
    }
  }
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

  const extractAllPages = (rawLine: string): number[] => {
    const label = rawLine.trim().replace(/^\|+/, "").trim();
    const re = /(?:^|[,\s|])(?:p(?:age)?\.?)?\s*(\d{1,6})\b/gi;
    const pages: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(label))) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n)) pages.push(n);
    }
    return pages;
  };

  for (const l of lines) {
    const pages = extractAllPages(l);
    if (!pages.length) {
      out.push(l);
      continue;
    }
    const invalid = pages.some((p) => p < 1 || p > maxPage);
    if (invalid) {
      if (!sawValid) continue; // drop leading p.0 etc
      break; // truncate hallucinated tail
    }
    sawValid = true;
    out.push(l);
  }
  return out.join("\n").trim();
}

function detectTranscriptMaxPage(transcript: string): number {
  // We want the *transcript* page count, not the PDF scan page count.
  // Many scanned depositions contain multiple transcript pages per PDF page and include markers like '(Pages 2 - 5)'.
  // Heuristics (in priority order):
  // - '(Pages X - Y)' ranges
  // - 'Page X' tokens
  // - 'X:Y' page:line tokens (strictly filtered: line <= 35, page <= 5000)
  // - Ignore our injected markers like '---PAGE 12---'
  const text = transcript.replace(/^---PAGE\s+\d+---\s*$/gim, "\n");

  let maxFromRange = 0;
  let maxFromPageWord = 0;
  let maxFromPageLine = 0;

  // '(Pages 2 - 5)'
  for (const m of text.matchAll(/\(\s*Pages?\s+(\d{1,6})\s*[-–—]\s*(\d{1,6})\s*\)/gi)) {
    const end = Number.parseInt(m[2], 10);
    if (Number.isFinite(end)) maxFromRange = Math.max(maxFromRange, end);
  }

  // 'p.239' / 'p.239:1-25'
  for (const m of text.matchAll(/\bp\.\s*(\d{1,6})\b/gi)) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n <= 5000) maxFromPageWord = Math.max(maxFromPageWord, n);
  }

  // 'Page 239'
  for (const m of text.matchAll(/\bPage\s+(\d{1,6})\b/gi)) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n <= 5000) maxFromPageWord = Math.max(maxFromPageWord, n);
  }

  // '239:3' (page:line)
  for (const m of text.matchAll(/\b(\d{1,6})\s*:\s*(\d{1,3})\b/g)) {
    const page = Number.parseInt(m[1], 10);
    const line = Number.parseInt(m[2], 10);
    // Deposition transcripts are typically 25 lines per page; be strict to avoid false positives.
    if (Number.isFinite(line) && line >= 0 && line <= 35 && Number.isFinite(page) && page >= 1 && page <= 5000) {
      maxFromPageLine = Math.max(maxFromPageLine, page);
    }
  }

  if (maxFromRange > 0) return maxFromRange;
  return Math.max(maxFromPageWord, maxFromPageLine);
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

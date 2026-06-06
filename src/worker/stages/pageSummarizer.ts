// src/worker/stages/pageSummarizer.ts
// Stage 3: Page Summarizer - Chunks pages and calls LLM for summaries

import axios from "axios";
import pLimit from "p-limit";
import { loadPromptConfig } from "../../lib/promptConfig";
import { splitPages } from "./pageCounter";

/**
 * Post-process LLM output to clean up page references.
 * KEEPS all line number references (including :1-25).
 */
function cleanupPageReferences(content: string): string {
  let cleaned = content;
  
  // DO NOT strip line numbers - keep them all, including :1-25
  // The user wants line number references preserved
  
  // Consolidate consecutive pages like "p.18, p.19, p.20, p.21" → "p.18-21"
  // Only for pages WITHOUT line numbers
  cleaned = cleaned.replace(/\bp\.(\d+)(?:,\s*p\.(\d+))+/gi, (match) => {
    if (match.includes(':')) return match; // Don't consolidate if has line numbers
    const pages = match.match(/\d+/g);
    if (!pages || pages.length < 2) return match;
    const nums = pages.map(Number).sort((a, b) => a - b);
    let isConsecutive = true;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] !== nums[i-1] + 1) {
        isConsecutive = false;
        break;
      }
    }
    if (isConsecutive && nums.length >= 3) {
      return `p.${nums[0]}-${nums[nums.length - 1]}`;
    }
    return match;
  });
  
  return cleaned;
}

// Tuning knobs (env-overridable)
const DETAIL_MODE = (process.env.SUMMARY_DETAIL_MODE || "high").toLowerCase();
// Reduced from 5 to 3 pages per chunk to force LLM to cover all pages (less content = harder to skip)
const PAGES_PER_CHUNK = Number(process.env.PAGE_RANGE_SIZE) || (DETAIL_MODE === "high" ? 3 : 4);
const AZURE_MAX_TOKENS = Number(process.env.AZURE_MAX_TOKENS) || (DETAIL_MODE === "high" ? 4000 : 3200);
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1);

export interface SummaryRow {
  pageLabel: string;
  summary: string;
}

export interface SummarizerResult {
  rows: SummaryRow[];
  rawMarkdown: string;
  tokensUsed: number;
  chunksProcessed: number;
}

export interface SummarizerInput {
  transcript: string;
  totalPages: number;
  metaMarkdown: string;
  jobId: string;
  onProgress?: (lastPage: number) => Promise<void>;
}

/**
 * Stage 3: Summarize transcript pages using Azure OpenAI.
 * Returns structured rows and raw markdown.
 */
export async function summarizePages(input: SummarizerInput): Promise<SummarizerResult> {
  const { transcript, totalPages, metaMarkdown, jobId, onProgress } = input;

  const pages = splitPages(transcript);
  const pdfPageCount = pages.length;
  const chunks = groupPagesToChunks(pages, PAGES_PER_CHUNK);

  console.log(
    `[${jobId}] PageSummarizer: ${chunks.length} chunks from ${pdfPageCount} pages, totalPages=${totalPages}`
  );

  const limit = pLimit(WORKER_CONCURRENCY);
  const parts: string[] = new Array(chunks.length).fill("");
  let totalTokens = 0;

  await Promise.all(
    chunks.map((chunk, i) =>
      limit(async () => {
        const cfg = loadPromptConfig();
        const resp = await withRetry(
          () =>
            azureChatCompletion(
              makePrompt(chunk, i === 0, metaMarkdown, cfg.system),
              typeof cfg.maxTokens === "number" ? cfg.maxTokens : AZURE_MAX_TOKENS,
              typeof cfg.temperature === "number" ? cfg.temperature : 0.0
            ),
          { retries: 5, minDelayMs: 2000, maxDelayMs: 30000 }
        );

        const rawContent = String(resp?.choices?.[0]?.message?.content || "").trim();
        // Post-process to remove line numbers and clean up page references
        const content = cleanupPageReferences(rawContent);
        parts[i] = content;
        totalTokens += resp?.usage?.total_tokens || 0;

        // Report progress
        if (onProgress) {
          const cappedPage = Math.min(
            totalPages,
            Math.max(1, Math.round((chunk.end / Math.max(1, pdfPageCount)) * totalPages))
          );
          await onProgress(cappedPage);
        }
      })
    )
  );

  // Merge and sanitize
  const mergedRaw = parts.join("\n");
  const sanitized = sanitizeGeneratedMarkdown(mergedRaw);
  const trimmed = trimOutOfRangeRows(sanitized, totalPages);

  // Parse into structured rows
  const rows = parseMarkdownRows(trimmed);

  console.log(
    `[${jobId}] PageSummarizer complete: ${rows.length} rows, ${totalTokens} tokens`
  );

  return {
    rows,
    rawMarkdown: trimmed,
    tokensUsed: totalTokens,
    chunksProcessed: chunks.length,
  };
}

// ─── Chunking ────────────────────────────────────────────────────────────────

function groupPagesToChunks(
  pages: { page: number; text: string }[],
  perChunk: number = PAGES_PER_CHUNK
): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < pages.length; i += perChunk) {
    const slice = pages.slice(i, i + perChunk);
    // Add clear page headers so the LLM knows exactly where each page starts
    // This helps prevent gaps in coverage and allows proper page referencing
    const textWithPageHeaders = slice.map((p) => {
      // Check if the page text already has line numbers (e.g., "1  Q.  Hello")
      const lines = p.text.split('\n');
      const hasLineNumbers = lines.some(line => /^\s*\d{1,2}\s+[A-Z]/.test(line));
      
      // Format page header clearly for LLM
      const header = `\n=== PAGE ${p.page} ===\n`;
      
      // If line numbers exist in text, preserve them; otherwise add placeholder
      if (hasLineNumbers) {
        return header + p.text;
      } else {
        // Add line number hints based on typical deposition format (25 lines per page)
        return header + `[Lines 1-25]\n` + p.text;
      }
    }).join("\n");
    
    out.push({
      start: slice[0].page,
      end: slice[slice.length - 1].page,
      text: textWithPageHeaders,
    });
  }
  return out;
}

// ─── LLM Prompting ───────────────────────────────────────────────────────────

function makePrompt(
  chunk: { start: number; end: number; text: string },
  isFirst: boolean,
  metaSection: string,
  systemInstruction: string
): any[] {
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

MANDATORY COVERAGE - READ CAREFULLY:
You are given transcript text for pages ${chunk.start} through ${chunk.end}.
Each page is marked with "=== PAGE X ===" headers.
You MUST produce summary rows that COLLECTIVELY cover EVERY SINGLE PAGE from ${chunk.start} to ${chunk.end}.
DO NOT SKIP ANY PAGES. If you skip pages, the output is INVALID.

REQUIRED OUTPUT:
Create 1-3 table rows that together cover ALL pages ${chunk.start}-${chunk.end}:

OUTPUT FORMAT:
- Output ONLY Markdown table rows: | Page/Line | Summary |
- No header row, just data rows
- First column: prefer "p.X" or "p.X-Y" when covering whole pages (omit :line-line for full pages); use line ranges only for partial pages
- Second column: 3-6 sentences summarizing the testimony
- Do NOT mention OCR or scanned text
- Cover:
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
Continue the deposition summary for pages ${chunk.start}–${chunk.end}.

MANDATORY: You MUST cover EVERY page from ${chunk.start} to ${chunk.end}. DO NOT SKIP ANY PAGES.

Output 1-3 Markdown table rows (| Page/Line | Summary |) that TOGETHER cover ALL pages in this range.
- First column: page range like "p.X-Y" or list pages
- Second column: 3-6 sentences summarizing the testimony
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

// ─── Azure OpenAI ────────────────────────────────────────────────────────────

function azureChatUsesMaxCompletionTokens(): boolean {
  if (process.env.AZURE_OPENAI_USE_MAX_COMPLETION_TOKENS === "true") return true;
  const dep = (process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "").toLowerCase();
  return dep.includes("gpt-5");
}

async function azureChatCompletion(
  messages: any[],
  maxTokens: number = AZURE_MAX_TOKENS,
  temperature: number = 0.0
): Promise<any> {
  const url = `${process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "")}/openai/deployments/${
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME
  }/chat/completions?api-version=${process.env.AZURE_API_VERSION}`;

  const payload = azureChatUsesMaxCompletionTokens()
    ? { messages, max_completion_tokens: maxTokens, temperature }
    : { messages, max_tokens: maxTokens, temperature };

  try {
    const { data } = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.AZURE_OPENAI_API_KEY!,
      },
      timeout: 120000,
    });
    return data;
  } catch (err: any) {
    // Log full Azure error response for debugging
    if (err.response?.data) {
      console.error("[Azure OpenAI Error]", JSON.stringify(err.response.data, null, 2));
      console.error("[Azure OpenAI Headers]", JSON.stringify(err.response.headers, null, 2));
    }
    throw err;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ─── Output Processing ───────────────────────────────────────────────────────

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
      if (maxPageSeen >= 20) sawSubstantialProgress = true;
      if (sawSubstantialProgress && pageNum <= maxPageSeen - 5) {
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
      if (!sawValid) continue;
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

function parseMarkdownRows(md: string): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const lines = md.split(/\r?\n/);

  for (const line of lines) {
    // Skip header/separator lines
    if (/^\s*\|?\s*-+/.test(line)) continue;
    if (/^\s*\|?\s*Page\s*\(?s?\)?\s*\|/i.test(line)) continue;

    // Parse table row
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

// Export for testing
export { groupPagesToChunks, sanitizeGeneratedMarkdown, trimOutOfRangeRows, parseMarkdownRows };





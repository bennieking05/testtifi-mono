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
import { sendEmail } from "../lib/sendEmail";
import { loadPromptConfig } from "../lib/promptConfig";
import pLimit from "p-limit";
import os from "os";

const prisma = new PrismaClient();
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files");
const summaryBucket = storage.bucket("deposition-summaries");
const visionClient = new vision.ImageAnnotatorClient();

console.log(
  "🔥 summarizeWorker.ts – brand-new build: " + new Date().toISOString()
);
console.log("=== Worker starting ===");

// Tuning knobs (env‑overridable)
const DETAIL_MODE = (process.env.SUMMARY_DETAIL_MODE || "high").toLowerCase();
const PAGES_PER_CHUNK = Number(process.env.PAGE_RANGE_SIZE) || (DETAIL_MODE === "high" ? 5 : 6);
const AZURE_MAX_TOKENS = Number(process.env.AZURE_MAX_TOKENS) || (DETAIL_MODE === "high" ? 4000 : 3200);
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1); // Reduced from 3 to 1 to avoid rate limits
const WORKER_ID = process.env.WORKER_ID || os.hostname();

async function extractFullText(
  buffer: Buffer,
  filename: string,
  gcsUri: string,
  jobId: string
): Promise<string> {
  const isPDF = filename.toLowerCase().endsWith(".pdf");
  const isDocx = /\.(docx?|DOCX?)$/.test(filename);

  if (isPDF) {
    const parsed = await pdf(buffer);
    if (parsed.text.trim().length > 100) return parsed.text;
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
  let combined = "";
  for (const f of jsonFiles) {
    const [raw] = await f.download();
    const parsed = JSON.parse(raw.toString());
    combined +=
      parsed.responses
        .map((r: any) => r.fullTextAnnotation?.text || "")
        .join("\n") + "\n";
  }
  // best-effort cleanup of temporary Vision output
  await Promise.all(
    files.map((f) => f.delete().catch(() => {}))
  );
  return combined.trim();
}

function splitPages(txt: string) {
  // Detect explicit page markers - handles multi-page scans (4 transcript pages per PDF page)
  // Look for: "Page 147", "147", standalone numbers, or "147:1" format
  // Be aggressive in finding page numbers since they may appear in corners/margins
  
  let currentPage: number | null = null;
  let buf: string[] = [];
  const out: { page: number; text: string }[] = [];

  const push = () => {
    if (buf.length && currentPage != null) {
      out.push({ page: currentPage, text: buf.join("\n") });
    }
    buf = [];
  };

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    
    // Pattern 1: Standalone page number (most common)
    // Matches: "147", "Page 147", "PAGE 147"
    const standaloneMatch = line.match(/^(?:Page\s*)?(\d{1,5})$/i);
    if (standaloneMatch) {
      push();
      currentPage = parseInt(standaloneMatch[1], 10);
      continue;
    }
    
    // Pattern 2: Page:Line format (e.g., "147:1-15")
    // Common in transcripts - extract just the page number
    const pageLineMatch = line.match(/^(\d{1,5}):\d/);
    if (pageLineMatch) {
      push();
      currentPage = parseInt(pageLineMatch[1], 10);
      continue;
    }
    
    // Pattern 3: Line starts or ends with just a number (corner numbers)
    // E.g., "147 " or " 147"
    if (line.length <= 6 && /^\d{1,5}$/.test(line)) {
      const num = parseInt(line, 10);
      // Only treat as page marker if it's reasonably sequential or first page
      if (currentPage === null || num === currentPage + 1 || num > currentPage) {
        push();
        currentPage = num;
        continue;
      }
    }
    
    buf.push(raw); // Keep original line with whitespace
  }

  // Flush last buffer
  push();
  
  // Deduplicate by page number, keeping the longest text segment per page
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

function extractLegalMetadata(tr: string) {
  const lines = tr.split(/\r?\n/);
  const header = lines.slice(0, 40).join("\n");

  const civMatch = header.match(
    /(CIVIL\s+ACTION\s+NO\.?|C\.A\.\s*NO\.?|CASE\s*NO\.?)[^\w]*(\w[\w\-\/:]*)/i
  );
  const civil = civMatch?.[2] || "[Unknown]";

  const captionLine =
    lines.slice(0, 40).find((l) => /\b(v\.|vs\.|versus)\b/i.test(l)) || "";
  const caption = captionLine.trim() || `Civil Action No. ${civil}`;

  const contDep = header.match(/continued\s+deposition\s+of\s+([^\n,]+)/i)?.[1];
  const depOf = header.match(/deposition\s+of\s+([^\n,]+)/i)?.[1];
  const deponent = (contDep || depOf || "[Unknown]").trim();

  const top3 = lines.slice(0, 3).join("\n");
  const dateRegex =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;
  const date =
    top3.match(dateRegex)?.[0] || header.match(dateRegex)?.[0] || "[Unknown]";

  return `
Case Caption: ${caption}
Title of Document: Transcript Summary of ${deponent}
Date of Deposition: ${date}
`.trim();
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

async function getRenderedEmailTemplate(
  templateId: number,
  variables: Record<string, string>
) {
  const emailTemplate = await prisma.email.findUnique({
    where: { id: templateId },
  });
  if (!emailTemplate) throw new Error(`Email template ${templateId} not found`);

  let { subject, body } = emailTemplate;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    body = body.replace(regex, value);
    subject = subject.replace(regex, value);
  }
  return { subject, body };
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
        fileName: true,
        notifyOnComplete: true,
        file: { select: { title: true } },
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
      const chunks = groupPagesToChunks(pages);
      const meta = extractLegalMetadata(transcript);

      // Persist totalPages early for better UI progress feedback
      try {
        const pageCount = pages.length;
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
                  makePrompt(chunk, i === 0, meta, cfg.system),
                  typeof cfg.maxTokens === "number" ? cfg.maxTokens : AZURE_MAX_TOKENS,
                  typeof cfg.temperature === "number" ? cfg.temperature : 0.0
                );
              },
              { retries: 5, minDelayMs: 2000, maxDelayMs: 30000 } // Increased retries and delays for rate limits
            );
            parts[i] = resp.choices[0].message.content.trim();
            // Best-effort progress update - cap at reasonable value
            const cappedPage = Math.min(chunk.end, 10000); // Cap at 10,000 to avoid showing huge numbers
            await prisma.summaryJob.update({
              where: { id: job.id },
              data: { lastPageProcessed: cappedPage },
            });
          })
        )
      );

      const mergedRaw = parts.join("\n");
      const rowsOnly = sanitizeGeneratedMarkdown(mergedRaw)
        .replace(/```[\s\S]*?```/g, "")
        .trim();
      const tableHeader = "| Page Number | Testimony |\n|-------------|-----------|";
      const merged = [meta, "", tableHeader, rowsOnly].join("\n\n");
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
          lastPageProcessed: pages.length ? Math.min(pages[pages.length - 1].page, 10000) : 0,
          totalPages: pages.length,
          finishedAt: new Date(),
        },
      });

      // Re-fetch notifyOnComplete at completion time to honor late opt-ins
      const fresh = await prisma.summaryJob.findUnique({
        where: { id: job.id },
        select: { notifyOnComplete: true },
      });
      if (fresh?.notifyOnComplete && user?.email) {
        console.log(`[${job.id}] 📧 Attempting to send email to ${user.email}`);
        try {
          const dashboardUrl = `${process.env.BASE_URL}`;
          try {
            const { subject, body } = await getRenderedEmailTemplate(4, {
              name: user.name || user.email,
              deposition_title: displayTitle,
              dashboard_link: dashboardUrl,
            });
            await sendEmail(user.email, subject, undefined, body);
          } catch (tplErr) {
            // Fallback minimal email if the template is missing or invalid
            console.warn(`[${job.id}] Email template fallback:`, tplErr);
            const subject = `Your deposition summary is ready`;
            const html = `
              <p>Hello ${user.name || user.email},</p>
              <p>Your deposition summary <strong>${displayTitle}</strong> is ready.</p>
              <p><a href="${dashboardUrl}">Open Testifi AI Dashboard</a></p>
            `;
            await sendEmail(user.email, subject, undefined, html);
          }
          console.log(`[${job.id}] 📬 Email sent to ${user.email}`);
        } catch (emailErr) {
          console.warn(`[${job.id}] Email failed:`, emailErr);
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
  const keep = lines.filter((l) => !banned.some((re) => re.test(l)));
  return keep.join("\n");
}

work().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

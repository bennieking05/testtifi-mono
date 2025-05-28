import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";
import axios from "axios";
import fs from "fs";
import path from "path";
import vision from "@google-cloud/vision";
import pdf from "pdf-parse";
import mammoth from "mammoth";

const prisma = new PrismaClient();
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files");
const summaryBucket = storage.bucket("deposition-summaries");
const visionClient = new vision.ImageAnnotatorClient();

/* ────────── TEXT EXTRACTION ────────── */
async function extractFullText(
  buffer: Buffer,
  filename: string,
  gcsUri: string
): Promise<string> {
  const isPDF = filename.toLowerCase().endsWith(".pdf");
  const isDocx = /\.(doc|docx)$/i.test(filename);

  if (isPDF) {
    const parsed = await pdf(buffer);
    if (parsed.text.trim().length > 100) return parsed.text;
    // scanned → OCR fallback
    return await extractTextWithVision(gcsUri);
  }
  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  return buffer.toString("utf-8");
}

async function extractTextWithVision(gcsUri: string): Promise<string> {
  const destinationUri = `gs://${summaryBucket.name}/vision-output/`;
  const [operation] = await visionClient.asyncBatchAnnotateFiles({
    requests: [
      {
        inputConfig: { gcsSource: { uri: gcsUri }, mimeType: "application/pdf" },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        outputConfig: { gcsDestination: { uri: destinationUri }, batchSize: 1 },
      },
    ],
  });
  await operation.promise();
  const [files] = await summaryBucket.getFiles({
    prefix: "vision-output/output-1-to-1.json",
  });
  const [outputBuffer] = await files[0].download();
  const parsed = JSON.parse(outputBuffer.toString());
  return parsed.responses
    .map((res: any) => res.fullTextAnnotation?.text || "")
    .join("\n");
}

/* ────────── PAGE HELPERS ────────── */
function splitPages(transcript: string): { page: number; text: string }[] {
  const lines = transcript.split("\n");
  let currentPage = 1;
  let buf: string[] = [];
  const out: { page: number; text: string }[] = [];

  for (const line of lines) {
    if (/^(?:\s*Page\s*)?\d+\s*$/.test(line.trim())) {
      if (buf.length) out.push({ page: currentPage++, text: buf.join("\n") });
      buf = [];
    }
    buf.push(line);
  }
  if (buf.length) out.push({ page: currentPage++, text: buf.join("\n") });
  return out;
}

function groupPagesToChunks(
  pages: { page: number; text: string }[],
  pagesPerChunk = 12
): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < pages.length; i += pagesPerChunk) {
    const chunkPages = pages.slice(i, i + pagesPerChunk);
    out.push({
      start: chunkPages[0].page,
      end: chunkPages[chunkPages.length - 1].page,
      text: chunkPages.map((p) => p.text).join("\n"),
    });
  }
  return out;
}

/* ────────── PROMPT BUILDERS ────────── */
function makePrompt(
  chunk: { start: number; end: number; text: string },
  isFirst: boolean,
  metaSection: string
) {
  return [
    {
      role: "system",
      content: `
You are a highly skilled legal paralegal AI that summarizes deposition transcripts. Output must be in Markdown with a case metadata section (only for the first chunk) and a highly detailed, page-by-page testimony table. Your summaries should match or exceed the specificity and structure of expert human-written legal summaries.
      `.trim(),
    },
    {
      role: "user",
      content: isFirst
        ? `
Summarize the following deposition transcript chunk (pages ${chunk.start}–${chunk.end}) with **great detail and accuracy**. Follow this structure:

**1. Case Metadata (at the top):**
${metaSection}

**2. Detailed Testimony Table (Markdown):**
- Create a table with **two columns**: (1) Page Number(s), (2) Summary of Testimony.
- Each row should summarize a specific page or small range of pages (e.g., 9–11, 12, 13–14, etc.).
- The summary for each row must be **rich with specific details** from the text:
  - Names and roles of individuals (attorneys, deponent, others mentioned).
  - References to **exhibits**, **emails**, or important documents (identify by number or description).
  - **Key questions and answers**, legal arguments, objections, and important points or admissions.
  - Dates, critical figures, or short direct quotes (as needed for clarity or emphasis).
- **Do not generalize.** Instead, create a factual, thorough, and clear summary for each segment, including every key topic, action, or exchange.
- Structure the table using standard Markdown syntax.

Below is the transcript text:
${chunk.text}
      `.trim()
        : `
Continue summarizing the deposition transcript from where the previous chunk ended (pages ${chunk.start}–${chunk.end}). **Do not repeat the metadata.**
- Use the same Markdown table structure, adding new rows for the next page numbers in this chunk.
- Continue in the same detailed, page-by-page style.

Below is the next chunk of transcript:
${chunk.text}
      `.trim(),
    },
  ];
}

function extractLegalMetadata(transcript: string): string {
  return `
- CIVIL ACTION NUMBER: ${
    transcript.match(/CIVIL ACTION NO[.,]?\s*([A-Za-z0-9\-]+)/i)?.[1] ||
    "[Unknown]"
  }
- COURT: ${
    transcript.match(
      /(CIRCUIT COURT.*|DISTRICT COURT.*|SUPERIOR COURT.*)/i
    )?.[1] || "[Unknown]"
  }
- PLAINTIFFS: ${
    transcript
      .match(/PLAINTIFFS[\s\S]{0,100}/i)
      ?.[0]
      ?.replace(/[\r\n]+/g, " ") || "[Unknown]"
  }
- DEFENDANTS: ${
    transcript
      .match(/DEFENDANTS[\s\S]{0,100}/i)
      ?.[0]
      ?.replace(/[\r\n]+/g, " ") || "[Unknown]"
  }
- DEPOSITION TITLE: ${
    transcript.match(/DEPOSITION SUMMARY OF ([A-Z\s\.\-]+),/i)?.[1]?.trim() ||
    "[Unknown]"
  }
- DATE: ${
    transcript.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/
    )?.[0] || "[Unknown]"
  }
  `.trim();
}

/* ────────── LLM CALL ────────── */
async function azureChatCompletion(messages: any[], maxTokens = 2800) {
  const url = `${process.env.AZURE_OPENAI_ENDPOINT?.replace(
    /\/+$/,
    ""
  )}/openai/deployments/${
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME
  }/chat/completions?api-version=${process.env.AZURE_API_VERSION}`;
  const headers = {
    "Content-Type": "application/json",
    "api-key": process.env.AZURE_OPENAI_API_KEY!,
  };
  const { data } = await axios.post(
    url,
    { messages, max_tokens: maxTokens, temperature: 0.1 },
    { headers, timeout: 120_000 }
  );
  return data;
}

/* ────────── WORKER LOOP ────────── */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mainWorkerLoop() {
  while (true) {
    const job = await prisma.summaryJob.findFirst({
      where: { status: "processing" },
    });
    if (!job) {
      await sleep(10_000);
      continue;
    }

    const user = await prisma.user.findUnique({ where: { id: job.userId } });
    if (!user) {
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { status: "error", error: "User not found" },
      });
      continue;
    }
    if (user.credits <= 0) {
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { status: "error", error: "Insufficient credits" },
      });
      continue;
    }
    // *** credit was already decremented in /api/upload – nothing to do here ***

    try {
      console.log(`[${job.id}] Starting chunked job for file: ${job.fileName}`);
      const [fileBuffer] = await depositionBucket
        .file(job.fileName)
        .download();
      const gcsUri = `gs://${depositionBucket.name}/${job.fileName}`;
      const transcript = await extractFullText(
        fileBuffer,
        job.fileName,
        gcsUri
      );
      const pages = splitPages(transcript);
      const chunks = groupPagesToChunks(pages, 12);
      const metaSection = extractLegalMetadata(transcript);

      const summaryParts: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const prompt = makePrompt(chunks[i], i === 0, metaSection);
        const resp = await azureChatCompletion(prompt, 2800);
        const summaryTable = resp.choices[0].message.content.trim();
        summaryParts.push(summaryTable);

        fs.writeFileSync(
          path.join("/tmp", `${job.id}-chunk-${i + 1}.md`),
          summaryTable
        );
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: { lastPageProcessed: chunks[i].end },
        });
      }

      const merged = summaryParts
        .map((part, idx) => {
          if (idx === 0) return part;
          return part.replace(/^.*?\| Page.*?\n\|[-\|]+\n/i, "");
        })
        .join("\n");

      const outFile = path.join("/tmp", `${job.id}.md`);
      fs.writeFileSync(outFile, merged);

      const destFile = `summary-${job.id}.md`;
      await summaryBucket.upload(outFile, {
        destination: destFile,
        contentType: "text/markdown",
      });
      const [mdUrl] = await summaryBucket.file(destFile).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 3 * 24 * 60 * 60 * 1000, // 3 days
      });

      await prisma.summaryJob.update({
        where: { id: job.id },
        data: {
          status: "complete",
          summaryCsvUrl: mdUrl,
          lastPageProcessed: chunks[chunks.length - 1].end,
        },
      });
      fs.unlinkSync(outFile);
      console.log(`[${job.id}] Completed and uploaded full chunked summary`);
    } catch (e: any) {
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { status: "error", error: e.message || "Failed" },
      });
      console.error(`[${job.id}] Worker error:`, e);
    }
  }
}

mainWorkerLoop().catch((e) => {
  console.error("Fatal error in worker:", e);
  process.exit(1);
});
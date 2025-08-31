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

const prisma = new PrismaClient();
const storage = new Storage();
const depositionBucket = storage.bucket("deposition-files");
const summaryBucket = storage.bucket("deposition-summaries");
const visionClient = new vision.ImageAnnotatorClient();

console.log(
  "🔥 summarizeWorker.ts – brand-new build: " + new Date().toISOString()
);
console.log("=== Worker starting ===");

async function extractFullText(
  buffer: Buffer,
  filename: string,
  gcsUri: string
): Promise<string> {
  const isPDF = filename.toLowerCase().endsWith(".pdf");
  const isDocx = /\.(docx?|DOCX?)$/.test(filename);

  if (isPDF) {
    const parsed = await pdf(buffer);
    if (parsed.text.trim().length > 100) return parsed.text;
    return extractTextWithVision(gcsUri);
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
    prefix: "vision-output/output-1-to-1.json",
  });
  const [raw] = await files[0].download();
  const parsed = JSON.parse(raw.toString());
  return parsed.responses
    .map((r: any) => r.fullTextAnnotation?.text || "")
    .join("\n");
}

function splitPages(txt: string) {
  // Detect explicit page markers and use their numeric value when present.
  // Common patterns: "Page 147", "147", "PAGE 147" centered on a line.
  const marker = /^\s*(?:Page\s*)?(\d{1,5})\s*$/i;
  let currentPage: number | null = null;
  let buf: string[] = [];
  const out: { page: number; text: string }[] = [];

  const push = () => {
    if (buf.length && currentPage != null) {
      out.push({ page: currentPage, text: buf.join("\n") });
    }
    buf = [];
  };

  for (const raw of txt.split("\n")) {
    const line = raw;
    const m = line.trim().match(marker);
    if (m) {
      // Starting a new page segment; flush previous
      push();
      currentPage = parseInt(m[1], 10);
      // Do not include the page marker line itself in content
      continue;
    }
    buf.push(line);
  }

  // Flush last buffer
  push();
  return out.sort((a, b) => a.page - b.page);
}

function groupPagesToChunks(
  pages: { page: number; text: string }[],
  perChunk = 12
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
  // Focus on the header area (first page, first ~30 lines)
  const lines = tr.split(/\r?\n/);
  const header = lines.slice(0, 30).join("\n");

  // Civil action number: support variants and first occurrence
  const civMatch = header.match(
    /(CIVIL\s+ACTION\s+NO\.?|C\.A\.\s*NO\.?|CASE\s*NO\.?)[^\w]*(\w[\w\-\/:]*)/i
  );
  const civil = civMatch?.[2] || "[Unknown]";

  // Deposition title: try "Continued deposition of <name>" first, fallback to generic "Deposition of <name>"
  const contDep = header.match(/continued\s+deposition\s+of\s+([^\n,]+)/i)?.[1];
  const depOf = header.match(/deposition\s+of\s+([^\n,]+)/i)?.[1];
  const title = (contDep || depOf || "[Unknown]").trim();

  // Date: prefer first 3 lines if present
  const top3 = lines.slice(0, 3).join("\n");
  const dateRegex =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;
  const date =
    top3.match(dateRegex)?.[0] || header.match(dateRegex)?.[0] || "[Unknown]";

  // Court
  const court =
    header.match(
      /(CIRCUIT COURT.*|DISTRICT COURT.*|SUPERIOR COURT.*|UNITED STATES DISTRICT COURT.*)/i
    )?.[1] || "[Unknown]";

  // Parties (keep short – avoid scooping whole caption)
  const pls =
    header.match(/PLAINTIFFS?[\s\S]{0,80}/i)?.[0]?.replace(/\s+/g, " ") ||
    "[Unknown]";
  const defs =
    header.match(/DEFENDANTS?[\s\S]{0,80}/i)?.[0]?.replace(/\s+/g, " ") ||
    "[Unknown]";

  return `
- CIVIL ACTION NUMBER: ${civil}
- COURT: ${court}
- PLAINTIFFS: ${pls}
- DEFENDANTS: ${defs}
- DEPOSITION TITLE: ${title}
- DATE: ${date}
`.trim();
}

function makePrompt(
  chunk: { start: number; end: number; text: string },
  isFirst: boolean,
  metaSection: string
) {
  return [
    {
      role: "system",
      content: `You are a highly skilled legal paralegal AI that summarizes deposition transcripts. Output must be in Markdown with a case metadata section (only for the first chunk) and a highly detailed, page-by-page testimony table.`,
    },
    {
      role: "user",
      content: isFirst
        ? `
Summarize pages ${chunk.start}–${chunk.end} with metadata and detailed table:

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

async function azureChatCompletion(messages: any[], max = 2800) {
  const url = `${process.env.AZURE_OPENAI_ENDPOINT!.replace(
    /\/+$/,
    ""
  )}/openai/deployments/${
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME
  }/chat/completions?api-version=${process.env.AZURE_API_VERSION}`;
  const { data } = await axios.post(
    url,
    { messages, max_tokens: max, temperature: 0.1 },
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
    const job = await prisma.summaryJob.findFirst({
      where: { status: "processing" },
      select: {
        id: true,
        userId: true,
        fileName: true,
        notifyOnComplete: true,
        file: { select: { title: true } },
      },
    });

    if (!job) {
      await sleep(10000);
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
      const transcript = await extractFullText(buf, job.fileName, gcsUri);
      const pages = splitPages(transcript);
      const chunks = groupPagesToChunks(pages);
      const meta = extractLegalMetadata(transcript);

      const parts: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const resp = await azureChatCompletion(
          makePrompt(chunks[i], i === 0, meta)
        );
        parts.push(resp.choices[0].message.content.trim());
        await prisma.summaryJob.update({
          where: { id: job.id },
          data: { lastPageProcessed: chunks[i].end },
        });
      }

      const merged = parts.join("\n");
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
          lastPageProcessed: pages[pages.length - 1].page,
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
        console.log("BASE_URL:", process.env.BASE_URL);
        try {
          const dashboardUrl = `${process.env.BASE_URL}`;
          console.log(`[${job.id}] 🌐 Dashboard URL: ${dashboardUrl}`);

          const { subject, body } = await getRenderedEmailTemplate(4, {
            name: user.name || user.email,
            deposition_title: displayTitle,
            dashboard_link: dashboardUrl,
          });

          await sendEmail(user.email, subject, undefined, body); // ✅ HTML body supported; text auto-generated
          console.log(`[${job.id}] 📬 Email sent to ${user.email}`);
        } catch (emailErr) {
          console.warn(`[${job.id}] Email failed:`, emailErr);
        }
      } else {
        console.log(
          `[${job.id}] ⚠️ Skipping email notification. notifyOnComplete: ${fresh?.notifyOnComplete}, user.email: ${user?.email}`
        );
      }

      fs.unlinkSync(tmpPath);
      console.log(`[${job.id}] ✅ Summary completed.`);
    } catch (e: any) {
      console.error(`[${job.id}] ❌ Error:`, e);
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: { status: "error", error: e.message || "Unknown error" },
      });
    }
  }
}

work().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

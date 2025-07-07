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

console.log("🔥 summarizeWorker.ts – new build: " + new Date().toISOString());
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
  let page = 1,
    buf: string[] = [],
    out: { page: number; text: string }[] = [];
  for (const line of txt.split("\n")) {
    if (/^(?:\s*Page\s*)?\d+\s*$/.test(line.trim())) {
      if (buf.length) out.push({ page: page++, text: buf.join("\n") });
      buf = [];
    }
    buf.push(line);
  }
  if (buf.length) out.push({ page: page++, text: buf.join("\n") });
  return out;
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
  return `
- CIVIL ACTION NUMBER: ${
    tr.match(/CIVIL ACTION NO[.,]?\s*([\w\-]+)/i)?.[1] || "[Unknown]"
  }
- COURT: ${
    tr.match(/(CIRCUIT COURT.*|DISTRICT COURT.*|SUPERIOR COURT.*)/i)?.[1] ||
    "[Unknown]"
  }
- PLAINTIFFS: ${
    tr.match(/PLAINTIFFS[\s\S]{0,100}/i)?.[0]?.replace(/\s+/g, " ") ||
    "[Unknown]"
  }
- DEFENDANTS: ${
    tr.match(/DEFENDANTS[\s\S]{0,100}/i)?.[0]?.replace(/\s+/g, " ") ||
    "[Unknown]"
  }
- DEPOSITION TITLE: ${
    tr.match(/DEPOSITION SUMMARY OF ([A-Z\s\.\-]+),/i)?.[1]?.trim() ||
    "[Unknown]"
  }
- DATE: ${
    tr.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/
    )?.[0] || "[Unknown]"
  }
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

      if (job.notifyOnComplete && user?.email) {
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

          await sendEmail(user.email, subject, undefined, body); // ✅ FIXED HERE
          console.log(`[${job.id}] 📬 Email sent to ${user.email}`);
        } catch (emailErr) {
          console.warn(`[${job.id}] Email failed:`, emailErr);
        }
      } else {
        console.log(
          `[${job.id}] ⚠️ Skipping email. notifyOnComplete: ${job.notifyOnComplete}, user.email: ${user?.email}`
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

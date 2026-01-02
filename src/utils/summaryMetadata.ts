import { Bucket } from "@google-cloud/storage";
import type { File as PrismaFile, SummaryJob } from "@prisma/client";

const METADATA_PREFIX = "summary-metadata-";

export interface JudgeResultSummary {
  name: string;
  passed: boolean;
  warnings: string[];
  instructions: string[];
}

export interface SummaryMetadata {
  jobId: string;
  caseCaption: string;
  caseNumber?: string | null;
  caseTitle: string;
  deponent: string;
  depositionDate: string;
  sourceFileName: string;
  totalPages: number;
  uploadDate: string;
  // Judge validation results (optional for backwards compatibility)
  judgeResults?: {
    allPassed: boolean;
    judges: JudgeResultSummary[];
  };
}

export function normalizeUnknownString(value?: string | null): string | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^\[?\s*unknown\s*\]?$/i.test(v)) return null;
  if (/^\[?\s*n\/a\s*\]?$/i.test(v)) return null;
  return v;
}

export function renderMetadataMarkdown(meta: SummaryMetadata): string {
  const depositionDate = normalizeUnknownString(meta.depositionDate);
  return [
    `Case Caption: ${meta.caseCaption}`,
    `Title of Document: Transcript Summary of ${meta.deponent}`,
    ...(depositionDate ? [`Date of Deposition: ${depositionDate}`] : []),
  ].join("\n");
}

export async function saveSummaryMetadata(
  bucket: Bucket,
  metadata: SummaryMetadata
): Promise<void> {
  const file = bucket.file(`${METADATA_PREFIX}${metadata.jobId}.json`);
  await file.save(JSON.stringify(metadata, null, 2), {
    contentType: "application/json",
  });
}

export async function loadSummaryMetadata(
  bucket: Bucket,
  jobId: string
): Promise<SummaryMetadata | null> {
  try {
    const [buf] = await bucket
      .file(`${METADATA_PREFIX}${jobId}.json`)
      .download();
    return JSON.parse(buf.toString());
  } catch (err: any) {
    if (err?.code !== 404) {
      console.warn(
        `[metadata] Failed to load metadata for ${jobId}:`,
        err?.message || err
      );
    }
    return null;
  }
}

export function fallbackSummaryMetadata(
  job: SummaryJob & { file?: PrismaFile | null }
): SummaryMetadata {
  const uploadDate = (job.createdAt || new Date()).toISOString();
  const totalPages =
    job.totalPages ||
    (job.file?.pages ? Number(job.file.pages) : undefined) ||
    0;
  return {
    jobId: job.id,
    caseCaption: job.file?.title || job.fileName || "Untitled Summary",
    caseNumber: null,
    caseTitle: job.file?.title || job.fileName || "Untitled Summary",
    deponent: job.file?.deponent || "Not Specified",
    depositionDate: "[Unknown]",
    sourceFileName: job.fileName,
    totalPages,
    uploadDate,
  };
}

export async function resolveSummaryMetadata(
  bucket: Bucket,
  job: SummaryJob & { file?: PrismaFile | null }
): Promise<SummaryMetadata> {
  const existing = await loadSummaryMetadata(bucket, job.id);
  if (existing) return existing;
  return fallbackSummaryMetadata(job);
}





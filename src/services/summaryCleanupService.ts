// ─── src/services/summaryCleanupService.ts ────────────────────────────────────────
// Service to clean up summaries older than 3 days per retention policy

import { PrismaClient } from "@prisma/client";
import { Storage } from "@google-cloud/storage";

const prisma = new PrismaClient();
const storage = new Storage();
const summaryBucket = storage.bucket("deposition-summaries");

const RETENTION_DAYS = 3;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Clean up summaries older than 3 days
 * Deletes summary files from storage and clears summary references in database
 * Keeps metadata and original deposition files
 */
export async function cleanupOldSummaries(): Promise<{
  deleted: number;
  errors: number;
}> {
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * DAY_IN_MS);
  
  console.log(`[SummaryCleanup] Starting cleanup for summaries older than ${cutoffDate.toISOString()}`);

  // Find completed summary jobs older than 3 days
  const oldJobs = await prisma.summaryJob.findMany({
    where: {
      status: "complete",
      finishedAt: {
        lt: cutoffDate,
      },
      summaryCsvUrl: {
        not: null,
      },
    },
    select: {
      id: true,
      summaryCsvUrl: true,
      file: {
        select: {
          id: true,
          summaryFileName: true,
        },
      },
    },
  });

  let deleted = 0;
  let errors = 0;

  for (const job of oldJobs) {
    try {
      // Extract object name from summaryCsvUrl or use summaryFileName
      let objectName: string | null = null;
      
      if (job.summaryCsvUrl) {
        try {
          const url = new URL(job.summaryCsvUrl);
          objectName = url.pathname.substring(url.pathname.lastIndexOf("/") + 1);
        } catch {
          // If URL parsing fails, try to extract from the URL string
          const match = job.summaryCsvUrl.match(/summary-[^/]+\.md/);
          if (match) {
            objectName = match[0];
          }
        }
      }
      
      if (!objectName && job.file?.summaryFileName) {
        objectName = job.file.summaryFileName;
      }
      
      if (!objectName) {
        // Fallback: use the standard naming convention
        objectName = `summary-${job.id}.md`;
      }

      // Delete from Google Cloud Storage
      try {
        const file = summaryBucket.file(objectName);
        const [exists] = await file.exists();
        if (exists) {
          await file.delete();
          console.log(`[SummaryCleanup] Deleted summary file: ${objectName} for job ${job.id}`);
        }
      } catch (storageErr: any) {
        console.warn(`[SummaryCleanup] Failed to delete storage file ${objectName} for job ${job.id}:`, storageErr.message);
        // Continue with database cleanup even if storage deletion fails
      }

      // Clear summary references in database (keep metadata)
      await prisma.summaryJob.update({
        where: { id: job.id },
        data: {
          summaryCsvUrl: null,
        },
      });

      // Clear summaryFileName from File if it exists
      if (job.file?.summaryFileName) {
        await prisma.file.update({
          where: { id: job.file.id },
          data: {
            summaryFileName: null,
            summaryUrl: null,
          },
        });
      }

      deleted++;
    } catch (error: any) {
      console.error(`[SummaryCleanup] Error cleaning up job ${job.id}:`, error.message);
      errors++;
    }
  }

  console.log(`[SummaryCleanup] Cleanup complete: ${deleted} summaries deleted, ${errors} errors`);
  return { deleted, errors };
}

/**
 * Run cleanup and return summary
 */
export async function runCleanup(): Promise<void> {
  try {
    const result = await cleanupOldSummaries();
    console.log(`[SummaryCleanup] Cleanup run completed:`, result);
  } catch (error: any) {
    console.error(`[SummaryCleanup] Cleanup run failed:`, error);
    throw error;
  }
}





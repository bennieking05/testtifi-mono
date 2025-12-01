import { PrismaClient } from "@prisma/client";

/**
 * Marks the completion email as sent for a summary job if it has not been sent already.
 * Returns true when the caller successfully claims the send operation.
 */
export async function claimCompletionEmailSend(
  prisma: PrismaClient,
  jobId: string
): Promise<boolean> {
  const result = await prisma.summaryJob.updateMany({
    where: { id: jobId, completionEmailSentAt: null },
    data: { completionEmailSentAt: new Date() },
  });

  return result.count > 0;
}

/**
 * Resets completionEmailSentAt back to null so another attempt can be made.
 */
export async function releaseCompletionEmailSend(
  prisma: PrismaClient,
  jobId: string
): Promise<void> {
  await prisma.summaryJob.updateMany({
    where: { id: jobId },
    data: { completionEmailSentAt: null },
  });
}



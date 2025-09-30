import { Prisma, type PrismaClient } from "@prisma/client";

export class InsufficientCreditsError extends Error {
  constructor(public readonly required: number, public readonly available: number) {
    super(`Insufficient credits: required ${required}, available ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

export interface AllocationDetail {
  purchaseId: string;
  creditsUsed: number;
  stripePaymentIntentId: string | null;
  purchaseCreatedAt: Date;
}

interface PurchaseCreditsRow {
  id: string;
  purchaseCreatedAt: Date;
  stripePaymentIntentId: string | null;
  totalCredits: number | bigint | null;
  usedCredits: number | bigint | null;
}

const toNumber = (value: number | bigint | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === "bigint" ? Number(value) : value;
};

export async function allocateCreditsFIFO(
  tx: Prisma.TransactionClient,
  userId: string,
  creditsNeeded: number,
  options: { excludePurchaseIds?: string[] } = {}
): Promise<{ allocations: AllocationDetail[]; totalAllocated: number; totalAvailable: number }>
{
  if (creditsNeeded <= 0) {
    return { allocations: [], totalAllocated: 0, totalAvailable: 0 };
  }

  const excludeIds = options.excludePurchaseIds ?? [];

  const rows = await tx.$queryRaw<PurchaseCreditsRow[]>(Prisma.sql`
    SELECT
      p.id,
      p.createdAt AS purchaseCreatedAt,
      p.stripePaymentIntentId,
      (
        SELECT COALESCE(SUM(le.credits), 0)
        FROM LedgerEntry le
        WHERE le.purchaseId = p.id
          AND le.userId = ${userId}
          AND le.type = 'credit'
      ) AS totalCredits,
      (
        SELECT COALESCE(SUM(ca.creditsUsed), 0)
        FROM CreditAllocation ca
        WHERE ca.purchaseId = p.id
      ) AS usedCredits
    FROM Purchase p
    WHERE p.userId = ${userId}
      ${excludeIds.length ? Prisma.sql`AND p.id NOT IN (${Prisma.join(excludeIds)})` : Prisma.empty}
    ORDER BY p.createdAt ASC
    FOR UPDATE
  `);

  let totalAvailable = 0;
  const normalized = rows.map((row) => {
    const totalCredits = toNumber(row.totalCredits);
    const usedCredits = toNumber(row.usedCredits);
    const available = totalCredits - usedCredits;
    if (available > 0) {
      totalAvailable += available;
    }
    return {
      id: row.id,
      purchaseCreatedAt: row.purchaseCreatedAt,
      stripePaymentIntentId: row.stripePaymentIntentId,
      totalCredits,
      usedCredits,
      available,
    };
  });

  if (totalAvailable < creditsNeeded) {
    throw new InsufficientCreditsError(creditsNeeded, totalAvailable);
  }

  let remaining = creditsNeeded;
  const allocations: AllocationDetail[] = [];

  for (const purchase of normalized) {
    if (remaining === 0) break;
    if (purchase.available <= 0) continue;

    const use = Math.min(purchase.available, remaining);
    if (use <= 0) continue;

    allocations.push({
      purchaseId: purchase.id,
      creditsUsed: use,
      stripePaymentIntentId: purchase.stripePaymentIntentId,
      purchaseCreatedAt: purchase.purchaseCreatedAt,
    });
    remaining -= use;
  }

  return { allocations, totalAllocated: creditsNeeded - remaining, totalAvailable };
}

export async function getPurchaseBalances(
  prisma: PrismaClient,
  userId: string
): Promise<Array<AllocationDetail & { creditsRemaining: number }>> {
  const rows = await prisma.$queryRaw<PurchaseCreditsRow[]>(Prisma.sql`
    SELECT
      p.id,
      p.createdAt AS purchaseCreatedAt,
      p.stripePaymentIntentId,
      (
        SELECT COALESCE(SUM(le.credits), 0)
        FROM LedgerEntry le
        WHERE le.purchaseId = p.id
          AND le.userId = ${userId}
          AND le.type = 'credit'
      ) AS totalCredits,
      (
        SELECT COALESCE(SUM(ca.creditsUsed), 0)
        FROM CreditAllocation ca
        WHERE ca.purchaseId = p.id
      ) AS usedCredits
    FROM Purchase p
    WHERE p.userId = ${userId}
    ORDER BY p.createdAt ASC
  `);

  return rows.map((row) => {
    const totalCredits = toNumber(row.totalCredits);
    const usedCredits = toNumber(row.usedCredits);
    const creditsRemaining = Math.max(totalCredits - usedCredits, 0);
    return {
      purchaseId: row.id,
      creditsUsed: 0,
      stripePaymentIntentId: row.stripePaymentIntentId,
      purchaseCreatedAt: row.purchaseCreatedAt,
      creditsRemaining,
    };
  });
}


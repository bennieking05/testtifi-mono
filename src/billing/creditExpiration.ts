import { Prisma, PrismaClient, PurchaseStatus } from "@prisma/client";

const LEDGER_EXPIRATION_PREFIX = "expire:";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRATION_DAYS = Number(process.env.CREDIT_EXPIRATION_DAYS ?? 3);

const toNumber = (value?: number | bigint | null): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === "bigint" ? Number(value) : value;
};

const normalizeStatusFilter = (): Prisma.PurchaseWhereInput["status"] => ({
  in: ["succeeded", "partially_refunded", "refunded"] satisfies PurchaseStatus[],
});

type ExpireOptions = {
  userId?: string;
  now?: Date;
};

export type ExpireSummary = {
  purchasesExpired: number;
  creditsExpired: number;
};

export async function expireUnusedCredits(
  prisma: PrismaClient,
  options: ExpireOptions = {}
): Promise<ExpireSummary> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - DEFAULT_EXPIRATION_DAYS * DAY_IN_MS);

  const purchaseWhere: Prisma.PurchaseWhereInput = {
    createdAt: { lt: cutoff },
    status: normalizeStatusFilter(),
  };

  if (options.userId) {
    purchaseWhere.userId = options.userId;
  }

  const purchases = await prisma.purchase.findMany({
    where: purchaseWhere,
    select: {
      id: true,
      userId: true,
      stripePaymentIntentId: true,
    },
  });

  let purchasesExpired = 0;
  let creditsExpired = 0;
  let ledgerUnavailable = false;

  for (const purchase of purchases) {
    if (ledgerUnavailable) break;

    try {
      const reclaimed = await prisma.$transaction(async (tx) => {
        const idempotencyKey = `${LEDGER_EXPIRATION_PREFIX}${purchase.id}`;
        const alreadyExpired = await tx.ledgerEntry.findUnique({
          where: { idempotencyKey },
        });
        if (alreadyExpired) return 0;

        const creditedAgg = await tx.ledgerEntry.aggregate({
          _sum: { credits: true },
          where: { purchaseId: purchase.id, type: "credit" },
        });
        const credited = toNumber(creditedAgg._sum.credits);
        if (credited <= 0) return 0;

        const usedAgg = await tx.creditAllocation.aggregate({
          _sum: { creditsUsed: true },
          where: { purchaseId: purchase.id },
        });
        const used = toNumber(usedAgg._sum.creditsUsed);

        const remaining = Math.max(credited - used, 0);
        if (remaining <= 0) return 0;

        await tx.ledgerEntry.create({
          data: {
            userId: purchase.userId,
            type: "credit",
            credits: -remaining,
            description: `Expired unused credits from ${
              purchase.stripePaymentIntentId ?? purchase.id
            }`,
            idempotencyKey,
            purchaseId: purchase.id,
          },
        });

        return remaining;
      });

      if (reclaimed > 0) {
        purchasesExpired += 1;
        creditsExpired += reclaimed;
      }
    } catch (error: any) {
      const code: string | undefined = error?.code || error?.meta?.code || error?.name;
      if (code === "P2021") {
        ledgerUnavailable = true;
        break;
      }
      throw error;
    }
  }

  return { purchasesExpired, creditsExpired };
}

export async function getEffectiveCreditBalance(
  prisma: PrismaClient,
  userId: string,
  options: { now?: Date } = {}
): Promise<number> {
  await expireUnusedCredits(prisma, { userId, now: options.now });

  try {
    const balanceAgg = await prisma.ledgerEntry.aggregate({
      _sum: { credits: true },
      where: { userId },
    });
    const entryCount = await prisma.ledgerEntry.count({ where: { userId } });
    const ledgerBalance = toNumber(balanceAgg._sum.credits);
    if (entryCount > 0 || ledgerBalance !== 0) {
      return ledgerBalance;
    }
  } catch (error: any) {
    const code: string | undefined = error?.code || error?.meta?.code || error?.name;
    if (code !== "P2021") {
      throw error;
    }
  }

  const fallbackUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });

  return fallbackUser?.credits ?? 0;
}


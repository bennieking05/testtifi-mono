import express, { Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { authenticateToken, type AuthRequest } from "../middlewares/authMiddleware";
import { allocateCreditsFIFO, InsufficientCreditsError } from "../billing/fifoAllocator";
import { expireUnusedCredits, getUsableCreditBalance, LEDGER_EXPIRATION_PREFIX } from "../billing/creditExpiration";
import { stringify } from "csv-stringify/sync";

let prisma: PrismaClient = new PrismaClient();
const defaultPrisma = prisma;

const toNumber = (value?: number | bigint | null): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === "bigint" ? Number(value) : value;
};

/**
 * Debits credits for a summary job. Returns the new balance.
 * Throws InsufficientCreditsError if not enough credits.
 */
export async function debitCreditsForSummary(
  userId: string,
  summaryId: string,
  summaryName?: string,
  creditsNeeded?: number
): Promise<number> {
  const creditsToDebit = creditsNeeded ?? Number(process.env.CREDITS_PER_SUMMARY ?? 1);
  
  if (!Number.isFinite(creditsToDebit) || creditsToDebit <= 0) {
    throw new Error("Invalid creditsNeeded");
  }

  await expireUnusedCredits(prisma, { userId });

  try {
    // Try the new ledger system first
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: `summary:${summaryId}` },
      });
      if (existing) {
        // Already debited, return current balance
        const balanceAgg = await tx.ledgerEntry.aggregate({
          _sum: { credits: true },
          where: { userId },
        });
        return Number(balanceAgg._sum.credits ?? 0);
      }

      const allocation = await allocateCreditsFIFO(tx, userId, creditsToDebit);

      await tx.ledgerEntry.create({
        data: {
          userId,
          type: "debit",
          credits: -creditsToDebit,
          summaryId,
          description: summaryName ?? undefined,
          idempotencyKey: `summary:${summaryId}`,
        },
      });

      if (allocation.allocations.length > 0) {
        const ledgerEntry = await tx.ledgerEntry.findUnique({
          where: { idempotencyKey: `summary:${summaryId}` },
        });
        if (ledgerEntry) {
          await tx.creditAllocation.createMany({
            data: allocation.allocations.map((alloc) => ({
              debitLedgerId: ledgerEntry.id,
              purchaseId: alloc.purchaseId,
              creditsUsed: alloc.creditsUsed,
            })),
          });
        }
      }

      const balanceAgg = await tx.ledgerEntry.aggregate({
        _sum: { credits: true },
        where: { userId },
      });
      return Number(balanceAgg._sum.credits ?? 0);
    });

    return result;
  } catch (ledgerError: any) {
    // Fallback to User.credits if LedgerEntry table doesn't exist (P2021)
    const code: string | undefined = ledgerError?.code || ledgerError?.meta?.code || ledgerError?.name;
    if (code === "P2021") {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });
      
      if (!user || user.credits < creditsToDebit) {
        throw new InsufficientCreditsError(creditsToDebit, user?.credits ?? 0);
      }

      await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: creditsToDebit } },
      });

      return user.credits - creditsToDebit;
    }
    throw ledgerError;
  }
}

export const __setPrismaClientForTests = (client: PrismaClient): void => {
  prisma = client;
};

export const __resetPrismaClientForTests = (): void => {
  prisma = defaultPrisma;
};

const router = express.Router();
const PAGE_SIZE = 20;
const CURSOR_SEPARATOR = "::";

type LedgerEntryTypeValue = "credit" | "debit" | "adjustment";

const parseDate = (raw: unknown): Date | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

const parseType = (raw: unknown): LedgerEntryTypeValue | undefined => {
  if (raw === "credit" || raw === "debit" || raw === "adjustment") {
    return raw as LedgerEntryTypeValue;
  }
  return undefined;
};

const encodeCursor = (entry: { id: string; createdAt: Date }): string => {
  const payload = `${entry.createdAt.toISOString()}${CURSOR_SEPARATOR}${entry.id}`;
  return Buffer.from(payload, "utf8").toString("base64");
};

const decodeCursor = (raw: unknown): { id: string; createdAt: Date } | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const [iso, id] = decoded.split(CURSOR_SEPARATOR);
    if (!iso || !id) return undefined;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.valueOf())) return undefined;
    return { id, createdAt };
  } catch {
    return undefined;
  }
};

router.get(
  "/balance",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;

    const balance = await getUsableCreditBalance(prisma, userId);

    const [expiredAgg, creditedAgg] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        _sum: { credits: true },
        where: {
          userId,
          type: "credit",
          credits: { lt: 0 },
          idempotencyKey: { startsWith: LEDGER_EXPIRATION_PREFIX },
        },
      }),
      prisma.ledgerEntry.aggregate({
        _sum: { credits: true },
        where: {
          userId,
          type: "credit",
          credits: { gt: 0 },
        },
      }),
    ]);

    const expiredCredits = Math.abs(toNumber(expiredAgg._sum.credits));
    const totalPurchasedCredits = toNumber(creditedAgg._sum.credits);

    res.json({
      balance,
      expiredCredits,
      totalPurchasedCredits,
    });
  }
);

router.get(
  "/history",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const type = parseType(req.query.type);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const cursor = decodeCursor(req.query.cursor);
    const wantsCsv = req.headers.accept?.includes("text/csv");

    try {
      const filters: Prisma.LedgerEntryWhereInput = {
        userId,
        type,
        createdAt: {
          gte: from,
          lte: to,
        },
      };

      if (!from && !to) {
        delete filters.createdAt;
      } else {
        if (!from && filters.createdAt && typeof filters.createdAt === "object" && "gte" in filters.createdAt) {
          delete (filters.createdAt as Prisma.DateTimeFilter).gte;
        }
        if (!to && filters.createdAt && typeof filters.createdAt === "object" && "lte" in filters.createdAt) {
          delete (filters.createdAt as Prisma.DateTimeFilter).lte;
        }
      }

      const entries = await prisma.ledgerEntry.findMany({
        where: filters,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        ...(cursor
          ? {
              skip: 1,
              cursor: { createdAt: cursor.createdAt, id: cursor.id },
            }
          : {}),
        include: {
          purchase: true,
          creditAllocations: {
            include: { purchase: true },
          },
        },
      });

      const hasMore = entries.length > PAGE_SIZE;
      const sliced = hasMore ? entries.slice(0, PAGE_SIZE) : entries;
      const nextCursor = hasMore
        ? encodeCursor({ id: sliced[sliced.length - 1]!.id, createdAt: sliced[sliced.length - 1]!.createdAt })
        : null;

      const balanceAgg = await prisma.ledgerEntry.aggregate({
        _sum: { credits: true },
        where: { userId },
      });
      const balance = toNumber(balanceAgg._sum.credits);

      if (wantsCsv) {
        const csv = stringify(
          sliced.map((entry) => ({
            id: entry.id,
            date: entry.createdAt.toISOString(),
            type: entry.type,
            credits: entry.credits,
            description: entry.description ?? "",
            summaryId: entry.summaryId ?? "",
            purchaseIntent: entry.purchase?.stripePaymentIntentId ?? "",
            purchaseId: entry.purchaseId ?? "",
            allocations: entry.creditAllocations
              .map((alloc) => `${alloc.purchase?.stripePaymentIntentId ?? alloc.purchaseId}:${alloc.creditsUsed}`)
              .join("|"),
          })),
          { header: true }
        );

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=billing-history.csv");
        res.send(csv);
        return;
      }

      res.json({
        balance,
        entries: sliced.map((entry) => ({
          id: entry.id,
          type: entry.type,
          credits: entry.credits,
          description: entry.description,
          summaryId: entry.summaryId,
          createdAt: entry.createdAt,
          purchase: entry.purchase
            ? {
                id: entry.purchase.id,
                stripePaymentIntentId: entry.purchase.stripePaymentIntentId,
                receiptUrl: entry.purchase.receiptUrl,
              }
            : null,
          allocations: entry.creditAllocations.map((alloc) => ({
            id: alloc.id,
            purchaseId: alloc.purchaseId,
            creditsUsed: alloc.creditsUsed,
            stripePaymentIntentId: alloc.purchase?.stripePaymentIntentId ?? null,
          })),
        })),
        nextCursor,
        hasMore,
      });
    } catch (err: any) {
      const code: string | undefined = err?.code || err?.meta?.code || err?.name;
      if (code === "P2021") {
        if (wantsCsv) {
          res.setHeader("Content-Type", "text/csv");
          res.setHeader("Content-Disposition", "attachment; filename=billing-history.csv");
          res.send("id,date,type,credits,description,summaryId,purchaseIntent,purchaseId,allocations\n");
          return;
        }
        res.json({ balance: 0, entries: [], nextCursor: null, hasMore: false });
        return;
      }
      throw err;
    }
  }
);

router.get(
  "/expired",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;

    try {
      await expireUnusedCredits(prisma, { userId });

      const entries = await prisma.ledgerEntry.findMany({
        where: {
          userId,
          type: "credit",
          credits: { lt: 0 },
          idempotencyKey: { startsWith: LEDGER_EXPIRATION_PREFIX },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          purchase: {
            select: {
              id: true,
              createdAt: true,
              stripePaymentIntentId: true,
            },
          },
        },
      });

      const payload = entries.map((entry) => ({
        id: entry.id,
        creditsExpired: Math.abs(entry.credits),
        expiredAt: entry.createdAt,
        purchaseId: entry.purchaseId,
        purchaseDate: entry.purchase?.createdAt ?? null,
        stripePaymentIntentId: entry.purchase?.stripePaymentIntentId ?? null,
      }));

      const totalExpired = payload.reduce(
        (sum, item) => sum + item.creditsExpired,
        0
      );

      res.json({
        totalExpired,
        entries: payload,
      });
    } catch (error) {
      console.error("[GET /api/billing/expired] error:", error);
      res.status(500).json({ error: "Failed to load expired credits" });
    }
  }
);

router.post(
  "/debit",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const { summaryId, summaryName, creditsNeeded } = req.body as {
      summaryId: string;
      summaryName?: string;
      creditsNeeded?: number;
    };

    if (!summaryId) {
      res.status(400).json({ error: "Missing summaryId" });
      return;
    }

    const creditsToDebit = creditsNeeded ?? Number(process.env.CREDITS_PER_SUMMARY ?? 1);
    if (!Number.isFinite(creditsToDebit) || creditsToDebit <= 0) {
      res.status(400).json({ error: "Invalid creditsNeeded" });
      return;
    }

    try {
      // Try the new ledger system first
      try {
        const { entry, allocations } = await prisma.$transaction(async (tx) => {
          const existing = await tx.ledgerEntry.findUnique({
            where: { idempotencyKey: `summary:${summaryId}` },
            include: {
              creditAllocations: {
                include: { purchase: true },
              },
            },
          });
          if (existing) {
            return { entry: existing, allocations: existing.creditAllocations };
          }

          const allocation = await allocateCreditsFIFO(tx, userId, creditsToDebit);

          const ledgerEntry = await tx.ledgerEntry.create({
            data: {
              userId,
              type: "debit",
              credits: -creditsToDebit,
              summaryId,
              description: summaryName ?? undefined,
              idempotencyKey: `summary:${summaryId}`,
            },
          });

          if (allocation.allocations.length > 0) {
            await tx.creditAllocation.createMany({
              data: allocation.allocations.map((alloc) => ({
                debitLedgerId: ledgerEntry.id,
                purchaseId: alloc.purchaseId,
                creditsUsed: alloc.creditsUsed,
              })),
            });
          }

          const entryWithAllocations = await tx.ledgerEntry.findUnique({
            where: { id: ledgerEntry.id },
            include: {
              creditAllocations: {
                include: { purchase: true },
              },
            },
          });

          return {
            entry: entryWithAllocations!,
            allocations: entryWithAllocations?.creditAllocations ?? [],
          };
        });

        const balanceAggregate = await prisma.ledgerEntry.aggregate({
          _sum: { credits: true },
          where: { userId },
        });

        res.json({
          entry,
          allocations,
          balance: Number(balanceAggregate._sum.credits ?? 0),
        });
        return;
      } catch (ledgerError: any) {
        // If the billing tables are not yet present in production, fall back to User.credits
        // Prisma P2021: table does not exist
        const code: string | undefined = ledgerError?.code || ledgerError?.meta?.code || ledgerError?.name;
        if (code === "P2021") {
          // Fallback to old User.credits system
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true },
          });
          
          if (!user || user.credits < creditsToDebit) {
            res.status(400).json({ error: "Insufficient credits" });
            return;
          }

          // Debit from User.credits
          await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: creditsToDebit } },
          });

          res.json({
            entry: null,
            allocations: [],
            balance: user.credits - creditsToDebit,
          });
          return;
        }
        throw ledgerError;
      }
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        res.status(402).json({ error: "INSUFFICIENT_CREDITS", required: error.required, available: error.available });
        return;
      }
      throw error;
    }
  }
);

export default router;


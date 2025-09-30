import express, { Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { authenticateToken, type AuthRequest } from "../middlewares/authMiddleware";
import { allocateCreditsFIFO, InsufficientCreditsError } from "../billing/fifoAllocator";
import { stringify } from "csv-stringify/sync";

let prisma: PrismaClient = new PrismaClient();
const defaultPrisma = prisma;

const toNumber = (value?: number | bigint | null): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === "bigint" ? Number(value) : value;
};

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

    const balanceAgg = await prisma.ledgerEntry.aggregate({
      _sum: { credits: true },
      where: { userId },
    });

    const balance = toNumber(balanceAgg._sum.credits);
    res.json({ balance });
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


import type { Prisma } from "@prisma/client";

type PurchaseRoutesModule = typeof import("../src/routes/purchaseRoutes");

let purchaseRoutes: PurchaseRoutesModule;

beforeAll(() => {
  process.env.STRIPE_API_KEY = process.env.STRIPE_API_KEY ?? "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_dummy";

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    purchaseRoutes = require("../src/routes/purchaseRoutes");
  });
});

describe("purchaseRoutes helpers", () => {
  describe("determineRefundCredits", () => {
    it("returns proportional credits for partial refunds", () => {
      const credits = purchaseRoutes.determineRefundCredits(10, 10_000, 5_000);
      expect(credits).toBe(5);
    });

    it("returns all credits when refund amount >= purchase amount", () => {
      const credits = purchaseRoutes.determineRefundCredits(8, 10_000, 12_000);
      expect(credits).toBe(8);
    });

    it("never returns zero for positive refunds", () => {
      const credits = purchaseRoutes.determineRefundCredits(2, 10_000, 1);
      expect(credits).toBe(2);
    });
  });

  describe("computeCreditsFromLineItems", () => {
    it("adds credits across line items and quantities", () => {
      const lineItems = [
        {
          quantity: 2,
          price: {
            product: {
              metadata: { credits: "3" },
            },
          },
        },
        {
          quantity: 1,
          price: {
            product: {
              metadata: { credits: "5" },
            },
          },
        },
      ] as any;

      const total = purchaseRoutes.computeCreditsFromLineItems(lineItems);
      expect(total).toBe(2 * 3 + 5);
    });

    it("ignores items without metadata", () => {
      const lineItems = [
        {
          quantity: 1,
          price: {
            product: {
              metadata: {},
            },
          },
        },
      ] as any;

      expect(purchaseRoutes.computeCreditsFromLineItems(lineItems)).toBe(0);
    });
  });

  describe("recordPurchaseCredit", () => {
    const paymentIntentId = "pi_test";
    const baseArgs = {
      paymentIntentId,
      userId: "user_1",
      credits: 10,
      amountCents: 12_500,
      currency: "usd",
      receiptUrl: "https://stripe.example/receipt",
    };

    const createTx = () => {
      const tx: Partial<Prisma.TransactionClient> = {
        purchase: {
          upsert: jest.fn().mockResolvedValue({ id: "purchase_1" }),
        } as any,
        ledgerEntry: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: "ledger_1" }),
        } as any,
      };
      return tx as Prisma.TransactionClient;
    };

    it("creates a ledger entry when idempotency key absent", async () => {
      const tx = createTx();

      await purchaseRoutes.recordPurchaseCredit(tx, baseArgs);

      expect(tx.purchase.upsert).toHaveBeenCalledTimes(1);
      expect(tx.ledgerEntry.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: `pi:${paymentIntentId}` } });
      expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: baseArgs.userId,
          credits: baseArgs.credits,
          idempotencyKey: `pi:${paymentIntentId}`,
          purchaseId: "purchase_1",
        }),
      });
    });

    it("skips creation when idempotency key exists", async () => {
      const tx = createTx();
      (tx.ledgerEntry.findUnique as jest.Mock).mockResolvedValue({ id: "existing" });

      await purchaseRoutes.recordPurchaseCredit(tx, baseArgs);

      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("recordRefundLedger", () => {
    const basePurchase = {
      id: "purchase_1",
      userId: "user_1",
      creditsAdded: 10,
      amountCents: 10_000,
    };

    const createTx = (overrides?: {
      aggregateSum?: number | null;
      existingLedger?: unknown;
      status?: string;
    }) => {
      const aggregateSum = overrides?.aggregateSum ?? 0;

      const tx: Partial<Prisma.TransactionClient> = {
        purchase: {
          findUnique: jest.fn().mockResolvedValue(basePurchase),
          update: jest.fn().mockResolvedValue({ ...basePurchase, status: overrides?.status ?? "succeeded" }),
        } as any,
        ledgerEntry: {
          findUnique: jest.fn().mockResolvedValue(overrides?.existingLedger ?? null),
          create: jest.fn(),
          aggregate: jest.fn().mockResolvedValue({ _sum: { credits: aggregateSum } }),
        } as any,
      };

      return tx as Prisma.TransactionClient;
    };

    const args = {
      paymentIntentId: "pi_123",
      refundId: "refund:123",
      refundAmount: 5_000,
      reason: "Refund test",
    };

    it("creates refund ledger and sets partial status", async () => {
      const tx = createTx();

      await purchaseRoutes.recordRefundLedger(tx, args);

      expect(tx.ledgerEntry.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: args.refundId } });
      expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ credits: -5, description: args.reason }),
      });
      expect(tx.purchase.update).toHaveBeenCalledWith({
        where: { id: basePurchase.id },
        data: { status: "partially_refunded" },
      });
    });

    it("marks purchase fully refunded when credits exhausted", async () => {
      const tx = createTx({ aggregateSum: -5 });

      await purchaseRoutes.recordRefundLedger(tx, args);

      expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ credits: -5 }),
      });
      expect(tx.purchase.update).toHaveBeenCalledWith({
        where: { id: basePurchase.id },
        data: { status: "refunded" },
      });
    });

    it("skips when idempotency key already processed", async () => {
      const tx = createTx({ existingLedger: { id: "already" } });

      await purchaseRoutes.recordRefundLedger(tx, args);

      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
      expect(tx.purchase.update).not.toHaveBeenCalled();
    });

    it("skips when remaining credits are zero", async () => {
      const tx = createTx({ aggregateSum: -10 });

      await purchaseRoutes.recordRefundLedger(tx, args);

      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    });
  });
});











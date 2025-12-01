import express, { Request, Response } from "express";
import Stripe from "stripe";
import { Prisma, PrismaClient } from "@prisma/client";
import { authenticateToken, requireAdmin } from "../middlewares/authMiddleware";
import { getEffectiveCreditBalance } from "../billing/creditExpiration";

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: "2025-09-30.clover",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const PAYMENT_LEDGER_PREFIX = "pi:";
const REFUND_LEDGER_PREFIX = "refund:";
const DISPUTE_LEDGER_PREFIX = "dispute:";

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function computeCreditsFromLineItems(items: Stripe.LineItem[]): number {
  return items.reduce((total, item) => {
    const product = item.price?.product;
    const quantity = item.quantity ?? 1;
    let creditsStr: string | undefined;
    if (product && typeof product !== "string" && !product.deleted) {
      creditsStr = product.metadata?.credits;
    }
    const credits = parsePositiveInt(creditsStr ?? "");
    if (!credits) return total;
    return total + credits * quantity;
  }, 0);
}

async function fetchCreditsForSession(session: Stripe.Checkout.Session): Promise<number> {
  const metadataCredits = parsePositiveInt(session.metadata?.credits ?? "");
  if (metadataCredits) return metadataCredits;

  const lineItems = session.line_items?.data?.length
    ? session.line_items.data
    : (
        await stripe.checkout.sessions.listLineItems(session.id, {
          expand: ["data.price.product"],
          limit: 100,
        })
      ).data;

  const lineItemCredits = computeCreditsFromLineItems(lineItems);
  if (lineItemCredits > 0) return lineItemCredits;

  throw new Error("Missing Stripe metadata for credits");
}

async function recordPurchaseCredit(
  tx: Prisma.TransactionClient,
  {
    paymentIntentId,
    userId,
    credits,
    amountCents,
    currency,
    receiptUrl,
  }: {
    paymentIntentId: string;
    userId: string;
    credits: number;
    amountCents: number;
    currency: string;
    receiptUrl?: string | null;
  }
): Promise<void> {
  const purchase = await tx.purchase.upsert({
    where: { stripePaymentIntentId: paymentIntentId },
    update: {
      userId,
      creditsAdded: credits,
      amountCents,
      currency,
      status: "succeeded",
      receiptUrl: receiptUrl ?? null,
    },
    create: {
      userId,
      stripePaymentIntentId: paymentIntentId,
      creditsAdded: credits,
      amountCents,
      currency,
      status: "succeeded",
      receiptUrl: receiptUrl ?? null,
    },
  });

  const idempotencyKey = `${PAYMENT_LEDGER_PREFIX}${paymentIntentId}`;

  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
  if (existing) return;

  await tx.ledgerEntry.create({
    data: {
      userId,
      type: "credit",
      credits,
      description: `Stripe payment ${paymentIntentId}`,
      idempotencyKey,
      purchaseId: purchase.id,
    },
  });
}

function determineRefundCredits(
  purchaseCredits: number,
  purchaseAmount: number,
  refundAmount: number
): number {
  if (!purchaseAmount || purchaseAmount <= 0) return purchaseCredits;
  const proportional = Math.round((purchaseCredits * refundAmount) / purchaseAmount);
  const credits = Math.min(purchaseCredits, proportional);
  return credits > 0 ? credits : purchaseCredits;
}

async function recordRefundLedger(
  tx: Prisma.TransactionClient,
  {
    paymentIntentId,
    refundId,
    refundAmount,
    reason,
  }: {
    paymentIntentId: string;
    refundId: string;
    refundAmount: number;
    reason: string;
  }
): Promise<void> {
  const purchase = await tx.purchase.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!purchase) {
    throw new Error(`Purchase not found for payment_intent ${paymentIntentId}`);
  }

  const idempotencyKey = `${refundId}`;
  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
  if (existing) return;

  const creditsToRevoke = determineRefundCredits(
    purchase.creditsAdded,
    purchase.amountCents,
    refundAmount
  );

  if (creditsToRevoke <= 0) return;

  const aggregate = await tx.ledgerEntry.aggregate({
    where: {
      purchaseId: purchase.id,
      credits: { lt: 0 },
    },
    _sum: { credits: true },
  });

  const alreadyRevoked = Math.abs(aggregate._sum.credits ?? 0);
  const remainingCredits = Math.max(purchase.creditsAdded - alreadyRevoked, 0);
  const creditsToApply = Math.min(creditsToRevoke, remainingCredits);

  if (creditsToApply <= 0) return;

  await tx.ledgerEntry.create({
    data: {
      userId: purchase.userId,
      type: "credit",
      credits: -Math.abs(creditsToApply),
      description: reason,
      idempotencyKey,
      purchaseId: purchase.id,
    },
  });

  const status = creditsToApply >= remainingCredits ? "refunded" : "partially_refunded";

  await tx.purchase.update({
    where: { id: purchase.id },
    data: { status },
  });
}

async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const userId = intent.metadata?.userId;
  const credits = parsePositiveInt(intent.metadata?.credits ?? "");

  if (!userId || !credits) {
    throw new Error("Missing metadata for credits or userId");
  }

  const amountCents = intent.amount_received ?? intent.amount ?? 0;
  const currency = intent.currency ?? "usd";
  const paymentIntentId = intent.id;
      const receiptUrl = (intent as any).charges?.data?.[0]?.receipt_url ?? null;

  await prisma.$transaction(async (tx) => {
    await recordPurchaseCredit(tx, {
      paymentIntentId,
      userId,
      credits,
      amountCents,
      currency,
      receiptUrl,
    });
  });
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) {
    throw new Error("Missing payment intent on checkout session");
  }

  const userId = session.metadata?.userId ?? session.client_reference_id;
  if (!userId) {
    throw new Error("Missing userId for checkout session");
  }

  const credits = await fetchCreditsForSession(session);
  const amountCents = session.amount_total ?? session.amount_subtotal ?? 0;
  const currency = session.currency ?? "usd";
      const receiptUrl = (session as any).latest_charge && typeof (session as any).latest_charge !== "string"
        ? (session as any).latest_charge.receipt_url
        : undefined;

  await prisma.$transaction(async (tx) => {
    await recordPurchaseCredit(tx, {
      paymentIntentId,
      userId,
      credits,
      amountCents,
      currency,
      receiptUrl,
    });
  });
}

async function handleRefund(refund: Stripe.Refund): Promise<void> {
  const paymentIntentId = refund.payment_intent;
  if (!paymentIntentId) return;

  const refundAmount = refund.amount ?? 0;
  if (refundAmount <= 0) return;

  await prisma.$transaction(async (tx) => {
    await recordRefundLedger(tx, {
      paymentIntentId: paymentIntentId as string,
      refundId: `${REFUND_LEDGER_PREFIX}${refund.id}`,
      refundAmount,
      reason: `Refund ${refund.id}`,
    });
  });
}

async function handleDispute(dispute: Stripe.Dispute): Promise<void> {
  const paymentIntentId = dispute.payment_intent;
  if (!paymentIntentId) return;

  const amount = dispute.amount ?? 0;
  if (amount <= 0) return;

  await prisma.$transaction(async (tx) => {
    await recordRefundLedger(tx, {
      paymentIntentId: paymentIntentId as string,
      refundId: `${DISPUTE_LEDGER_PREFIX}${dispute.id}`,
      refundAmount: amount,
      reason: `Charge dispute ${dispute.id}`,
    });
  });
}

export const stripeWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  if (!webhookSecret) {
    res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    return;
  }

  const signature = req.headers["stripe-signature"] as string | undefined;
  if (!signature) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch ((event as any).type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "charge.refund.created":
        await handleRefund((event as any).data.object as Stripe.Refund);
        break;
      case "charge.dispute.created":
        await handleDispute(event.data.object as Stripe.Dispute);
        break;
      default:
        break;
    }
  } catch (err: any) {
    console.error("Stripe webhook processing error", err);
    res.status(500).json({ error: err.message || "Webhook processing failed" });
    return;
  }

  res.json({ received: true });
};

router.post("/purchase-credits", authenticateToken, async (req: Request, res: Response) => {
  const userId = (req as any).user.userId as string;
  const { amountCents, credits } = req.body as { amountCents?: number; credits?: number };

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!amountCents || !credits) {
    res.status(400).json({ error: "Missing amountCents or credits" });
    return;
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    metadata: {
      userId,
      credits: String(credits),
    },
  });

  await prisma.purchase.upsert({
    where: { stripePaymentIntentId: paymentIntent.id },
    update: {
      userId,
      amountCents,
      creditsAdded: credits,
      currency: "usd",
      status: "requires_payment_method",
    },
    create: {
      userId,
      stripePaymentIntentId: paymentIntent.id,
      amountCents,
      creditsAdded: credits,
      currency: "usd",
      status: "requires_payment_method",
    },
  });

  res.json({ clientSecret: paymentIntent.client_secret });
});

router.post(
  "/confirm",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId as string | undefined;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { paymentIntentId } = req.body as { paymentIntentId?: string };
      if (!paymentIntentId) {
        res.status(400).json({ error: "paymentIntentId is required" });
        return;
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (!paymentIntent) {
        res.status(404).json({ error: "Payment intent not found" });
        return;
      }

      const ownerId = paymentIntent.metadata?.userId;
      if (!ownerId || ownerId !== userId) {
        res.status(403).json({ error: "Payment does not belong to this user" });
        return;
      }

      await handlePaymentIntentSucceeded(paymentIntent as Stripe.PaymentIntent);

      const balance = await getEffectiveCreditBalance(prisma, userId);
      const creditsAdded = parsePositiveInt(paymentIntent.metadata?.credits ?? "") ?? 0;

      res.json({ balance, creditsAdded });
    } catch (err) {
      console.error("[POST /api/purchase/confirm] error", err);
      res.status(500).json({ error: "Failed to confirm purchase" });
    }
  }
);

router.get(
  "/history",
  authenticateToken,
  requireAdmin,
  async (_req: Request, res: Response) => {
    const purchases = await prisma.purchase.findMany({
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      purchases.map((purchase) => ({
        id: purchase.id,
        paymentIntent: purchase.stripePaymentIntentId,
        amountCents: purchase.amountCents,
        currency: purchase.currency,
        creditsAdded: purchase.creditsAdded,
        status: purchase.status,
        receiptUrl: purchase.receiptUrl,
        user: purchase.user,
        createdAt: purchase.createdAt,
      }))
    );
  }
);

router.get(
  "/user-history",
  authenticateToken,
  async (req: Request, res: Response) => {
    const userId = (req as any).user.userId as string;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const purchases = await prisma.purchase.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      purchases.map((purchase) => ({
        id: purchase.id,
        paymentIntent: purchase.stripePaymentIntentId,
        amountCents: purchase.amountCents,
        currency: purchase.currency,
        creditsAdded: purchase.creditsAdded,
        status: purchase.status,
        receiptUrl: purchase.receiptUrl,
        createdAt: purchase.createdAt,
      }))
    );
  }
);

export default router;
export {
  handlePaymentIntentSucceeded,
  handleCheckoutSessionCompleted,
  handleRefund,
  handleDispute,
  recordPurchaseCredit,
  recordRefundLedger,
  determineRefundCredits,
};

import express, { Request, Response } from "express";
import Stripe from "stripe";
import { Prisma, PrismaClient } from "@prisma/client";
import { authenticateToken, requireAdmin } from "../middlewares/authMiddleware";
import { getEffectiveCreditBalance } from "../billing/creditExpiration";
import { sendEmail } from "../lib/sendEmail";

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
): Promise<boolean> {
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
  if (existing) return false;

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

  return true;
}

async function sendPurchaseReceiptEmail({
  userId,
  credits,
  amountCents,
  currency,
  paymentIntentId,
  receiptUrl,
}: {
  userId: string;
  credits: number;
  amountCents: number;
  currency: string;
  paymentIntentId: string;
  receiptUrl?: string | null;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user?.email) {
      console.warn("Purchase receipt email skipped: user email missing", {
        userId,
      });
      return;
    }

    const amountFormatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);

    const subject = `Receipt: ${credits} summary credit${credits === 1 ? "" : "s"} added to your Testifi AI account`;
    const greetingName = user.name?.split(" ")[0] ?? "there";

    const htmlLines = [
      `<p>Hi ${greetingName},</p>`,
      `<p>Thank you for your purchase. We've added <strong>${credits.toLocaleString()} summary credit${credits === 1 ? "" : "s"}</strong> to your Testifi AI account.</p>`,
      `<ul>`,
      `<li><strong>Payment amount:</strong> ${amountFormatted}</li>`,
      `<li><strong>Payment ID:</strong> ${paymentIntentId}</li>`,
      `</ul>`,
      receiptUrl
        ? `<p>You can download the Stripe receipt <a href="${receiptUrl}">here</a>.</p>`
        : "",
      `<p>The credits are ready to use immediately. If you have any questions, reply to this email or contact <a href="mailto:support@testifi.ai">support@testifi.ai</a>.</p>`,
      `<p>— The Testifi AI Team</p>`,
    ].filter(Boolean);

    const html = htmlLines.join("\n");
    const text = [
      `Hi ${greetingName},`,
      "",
      `Thank you for your purchase. We've added ${credits} summary credit${credits === 1 ? "" : "s"} to your Testifi AI account.`,
      `Payment amount: ${amountFormatted}`,
      `Payment ID: ${paymentIntentId}`,
      receiptUrl ? `Stripe receipt: ${receiptUrl}` : "",
      "",
      "The credits are ready to use immediately. If you have any questions, reply to this email or contact support@testifi.ai.",
      "",
      "— The Testifi AI Team",
    ]
      .filter(Boolean)
      .join("\n");

    await sendEmail(user.email, subject, text, html);
  } catch (error) {
    console.error("Failed to send purchase receipt email:", error);
  }
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

  const created = await prisma.$transaction(async (tx) =>
    recordPurchaseCredit(tx, {
      paymentIntentId,
      userId,
      credits,
      amountCents,
      currency,
      receiptUrl,
    })
  );

  if (created) {
    await sendPurchaseReceiptEmail({
      userId,
      credits,
      amountCents,
      currency,
      paymentIntentId,
      receiptUrl: receiptUrl ?? undefined,
    });
  }
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

  const created = await prisma.$transaction(async (tx) =>
    recordPurchaseCredit(tx, {
      paymentIntentId,
      userId,
      credits,
      amountCents,
      currency,
      receiptUrl,
    })
  );

  if (created) {
    await sendPurchaseReceiptEmail({
      userId,
      credits,
      amountCents,
      currency,
      paymentIntentId,
      receiptUrl,
    });
  }
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
  console.log("🔔 Stripe webhook received");
  
  if (!webhookSecret) {
    console.error("❌ Missing STRIPE_WEBHOOK_SECRET");
    res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    return;
  }

  const signature = req.headers["stripe-signature"] as string | undefined;
  if (!signature) {
    console.error("❌ Missing stripe-signature header");
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    console.log(`✅ Webhook verified: ${event.type}`);
  } catch (err: any) {
    console.error("❌ Stripe webhook signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch ((event as any).type) {
      case "payment_intent.succeeded":
        console.log("💳 Processing payment_intent.succeeded");
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        console.log("✅ Payment intent processed successfully");
        break;
      case "checkout.session.completed":
        console.log("🛒 Processing checkout.session.completed");
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        console.log("✅ Checkout session processed successfully");
        break;
      case "charge.refund.created":
        console.log("💸 Processing charge.refund.created");
        await handleRefund((event as any).data.object as Stripe.Refund);
        console.log("✅ Refund processed successfully");
        break;
      case "charge.dispute.created":
        console.log("⚠️ Processing charge.dispute.created");
        await handleDispute(event.data.object as Stripe.Dispute);
        console.log("✅ Dispute processed successfully");
        break;
      default:
        console.log(`ℹ️ Unhandled webhook type: ${event.type}`);
        break;
    }
  } catch (err: any) {
    console.error("❌ Stripe webhook processing error:", err);
    res.status(500).json({ error: err.message || "Webhook processing failed" });
    return;
  }

  console.log("✅ Webhook handled successfully");
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
  async (req: Request, res: Response) => {
    const userId = (req as any).user.userId as string;
    const { paymentIntentId } = req.body as { paymentIntentId?: string };

    if (!paymentIntentId) {
      res.status(400).json({ error: "Missing paymentIntentId" });
      return;
    }

    try {
      // Check if credits were already added (check ledger entry, not just purchase)
      const idempotencyKey = `${PAYMENT_LEDGER_PREFIX}${paymentIntentId}`;
      const existingLedgerEntry = await prisma.ledgerEntry.findUnique({
        where: { idempotencyKey },
      });

      if (existingLedgerEntry) {
        // Credits already added, just return current balance
        const balance = await getEffectiveCreditBalance(prisma, userId);
        const existingPurchase = await prisma.purchase.findUnique({
          where: { stripePaymentIntentId: paymentIntentId },
        });
        res.json({
          balance,
          creditsAdded: existingPurchase?.creditsAdded ?? 0,
          alreadyProcessed: true,
        });
        return;
      }

      let intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["charges.data", "latest_charge"],
      });

      if (!intent) {
        res.status(404).json({ error: "PaymentIntent not found" });
        return;
      }

      console.log(`[confirm] PaymentIntent ${paymentIntentId} status: ${intent.status}`);

      const intentUserId = intent.metadata?.userId ?? null;
      if (!intentUserId || intentUserId !== userId) {
        res.status(403).json({ error: "PaymentIntent does not belong to this user" });
        return;
      }

      // Allow processing if succeeded or processing (might be in transition)
      if (intent.status !== "succeeded" && intent.status !== "processing") {
        console.log(`[confirm] PaymentIntent ${paymentIntentId} rejected - status: ${intent.status}`);
        res.status(400).json({ 
          error: `PaymentIntent not succeeded (status: ${intent.status})`,
          status: intent.status 
        });
        return;
      }

      // If processing, wait a moment and check again (up to 3 times)
      if (intent.status === "processing") {
        console.log(`[confirm] PaymentIntent ${paymentIntentId} is processing, waiting...`);
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const refreshedIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
          console.log(`[confirm] Retry ${i + 1}: PaymentIntent ${paymentIntentId} status: ${refreshedIntent.status}`);
          if (refreshedIntent.status === "succeeded") {
            intent = refreshedIntent as Stripe.PaymentIntent;
            break;
          }
          if (i === 2) {
            res.status(400).json({ 
              error: `PaymentIntent still processing after retries (status: ${refreshedIntent.status})`,
              status: refreshedIntent.status 
            });
            return;
          }
        }
      }

      const credits = parsePositiveInt(intent.metadata?.credits ?? "");
      if (!credits) {
        res.status(400).json({ error: "Unable to determine purchased credits" });
        return;
      }

      const amountCents = intent.amount_received ?? intent.amount ?? 0;
      const currency = intent.currency ?? "usd";
      const receiptUrl =
        (intent as any).charges?.data?.[0]?.receipt_url ??
        ((intent as any).latest_charge &&
        typeof (intent as any).latest_charge !== "string"
          ? (intent as any).latest_charge.receipt_url
          : undefined);

      const created = await prisma.$transaction((tx) =>
        recordPurchaseCredit(tx, {
          paymentIntentId,
          userId,
          credits,
          amountCents,
          currency,
          receiptUrl,
        })
      );

      if (created) {
        await sendPurchaseReceiptEmail({
          userId,
          credits,
          amountCents,
          currency,
          paymentIntentId,
          receiptUrl,
        });
      }

      const balance = await getEffectiveCreditBalance(prisma, userId);

      res.json({
        balance,
        creditsAdded: credits,
      });
    } catch (error: any) {
      console.error("Error confirming purchase:", error);
      // If it's a Stripe error about unexpected state, check if credits were already added
      if (error?.code === "payment_intent_unexpected_state" || error?.type === "StripeInvalidRequestError") {
        const idempotencyKey = `${PAYMENT_LEDGER_PREFIX}${paymentIntentId}`;
        const existingLedgerEntry = await prisma.ledgerEntry.findUnique({
          where: { idempotencyKey },
        });
        if (existingLedgerEntry) {
          const balance = await getEffectiveCreditBalance(prisma, userId);
          const existingPurchase = await prisma.purchase.findUnique({
            where: { stripePaymentIntentId: paymentIntentId },
          });
          res.json({
            balance,
            creditsAdded: existingPurchase?.creditsAdded ?? 0,
            alreadyProcessed: true,
          });
          return;
        }
      }
      const status = error?.statusCode ?? 500;
      res.status(status).json({
        error: error?.message ?? "Failed to confirm purchase",
      });
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

    // Only show actual Stripe purchases (not manual credits)
    const purchases = await prisma.purchase.findMany({
      where: { 
        userId,
        stripePaymentIntentId: { not: null as any },
        status: { in: ["succeeded", "partially_refunded", "refunded"] }
      },
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

router.get(
  "/stripe-account",
  authenticateToken,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const account = await stripe.accounts.retrieve();
      res.json({ accountId: account.id });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? "Unable to retrieve account" });
    }
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

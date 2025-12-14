import express, { Request, Response } from "express";
import Stripe from "stripe";
import { Prisma, PrismaClient, Purchase } from "@prisma/client";
import { authenticateToken, requireAdmin } from "../middlewares/authMiddleware";
import { getEffectiveCreditBalance } from "../billing/creditExpiration";
import { sendEmail, EmailAttachment } from "../lib/sendEmail";
import { loadLightLogo } from "../utils/logo";
import { renderEmailShell } from "../utils/emailTheme";

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: "2025-10-29.clover",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const PAYMENT_LEDGER_PREFIX = "pi:";
const REFUND_LEDGER_PREFIX = "refund:";
const DISPUTE_LEDGER_PREFIX = "dispute:";
const emailTheme = (process.env.EMAIL_THEME as any) || "auto";

function getTierUnitPrice(credits: number): number {
  if (credits >= 50) return 100;
  if (credits >= 25) return 110;
  if (credits >= 10) return 120;
  return credits > 0 ? 125 : 0;
}

function computeSubtotalCents(credits: number): number | null {
  if (!credits || credits <= 0) return null;
  const subtotalDollars = getTierUnitPrice(credits) * credits;
  return Math.round(subtotalDollars * 100);
}

function deriveTaxCents({
  totalCents,
  subtotalCents,
  taxOverrideCents,
}: {
  totalCents: number;
  subtotalCents?: number | null;
  taxOverrideCents?: number | null;
}): number | null {
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    return null;
  }
  if (typeof taxOverrideCents === "number") {
    return Math.max(taxOverrideCents, 0);
  }
  if (typeof subtotalCents === "number") {
    return Math.max(totalCents - subtotalCents, 0);
  }
  return null;
}

function getChargeList(intent: Stripe.PaymentIntent): Array<{ receipt_url?: string | null }> {
  const charges = (intent as any).charges?.data;
  return Array.isArray(charges) ? (charges as Array<{ receipt_url?: string | null }>) : [];
}

function extractReceiptUrl(intent: Stripe.PaymentIntent): string | null {
  const latestCharge = intent.latest_charge;
  if (latestCharge && typeof latestCharge !== "string" && latestCharge.receipt_url) {
    return latestCharge.receipt_url;
  }
  const chargeWithReceipt = getChargeList(intent).find((charge) => Boolean(charge.receipt_url));
  return chargeWithReceipt?.receipt_url ?? null;
}

async function ensureIntentHasReceiptData(intent: Stripe.PaymentIntent): Promise<Stripe.PaymentIntent> {
  const hasReceipt =
    (intent.latest_charge && typeof intent.latest_charge !== "string" && Boolean(intent.latest_charge.receipt_url)) ||
    getChargeList(intent).some((charge) => Boolean(charge.receipt_url));

  if (hasReceipt) {
    return intent;
  }

  try {
    return (await stripe.paymentIntents.retrieve(intent.id, { expand: ["latest_charge"] })) as Stripe.PaymentIntent;
  } catch (err) {
    console.warn(`[purchase-receipt] Unable to hydrate payment intent ${intent.id}`, err);
    return intent;
  }
}

function formatCurrency(amountCents: number, currency: string): string {
  const value = (amountCents || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

async function sendPurchaseReceiptEmail({
  userId,
  credits,
  amountCents,
  currency,
  receiptUrl,
  paymentIntentId,
  subtotalCents,
  taxCents,
  taxLabel,
}: {
  userId: string;
  credits: number;
  amountCents: number;
  currency: string;
  receiptUrl?: string | null;
  paymentIntentId: string;
  subtotalCents?: number | null;
  taxCents?: number | null;
  taxLabel?: string | null;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.email) {
    console.warn(`[purchase-receipt] Missing email for user ${userId}`);
    return;
  }

  let resolvedReceiptUrl = receiptUrl ?? null;
  if (!resolvedReceiptUrl) {
    try {
      const hydratedIntent = (await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      })) as Stripe.PaymentIntent;
      resolvedReceiptUrl = extractReceiptUrl(hydratedIntent);

      if (resolvedReceiptUrl) {
        await prisma.purchase
          .updateMany({
            where: { stripePaymentIntentId: paymentIntentId },
            data: { receiptUrl: resolvedReceiptUrl },
          })
          .catch((err) => {
            console.warn(`[purchase-receipt] Failed to persist Stripe receipt ${paymentIntentId}`, err);
          });
      }
    } catch (err) {
      console.warn(`[purchase-receipt] Unable to fetch Stripe receipt ${paymentIntentId}`, err);
    }
  }

  const greetingName = user.name || user.email;
  const creditsLabel = credits.toLocaleString();
  const creditNoun = `summary credit${credits === 1 ? "" : "s"}`;
  const amountLabel = formatCurrency(amountCents, currency);
  const resolvedSubtotalCents =
    typeof subtotalCents === "number" ? subtotalCents : computeSubtotalCents(credits);
  const resolvedTaxCents = deriveTaxCents({
    totalCents: amountCents,
    subtotalCents: resolvedSubtotalCents,
    taxOverrideCents: typeof taxCents === "number" ? taxCents : undefined,
  });
  const subtotalLabel =
    typeof resolvedSubtotalCents === "number" ? formatCurrency(resolvedSubtotalCents, currency) : null;
  const showTaxRow = typeof resolvedTaxCents === "number";
  const taxAmountLabel = showTaxRow ? formatCurrency(resolvedTaxCents ?? 0, currency) : null;
  const taxDescription = taxLabel ?? (showTaxRow ? "Sales Tax (if applicable)" : null);
  const subject = `Receipt for ${creditsLabel} summary credit${credits === 1 ? "" : "s"}`;
  const breakdownLines = [
    `Credits Added: ${creditsLabel}`,
    subtotalLabel ? `Subtotal (${creditsLabel} ${creditNoun}): ${subtotalLabel}` : null,
    showTaxRow && taxAmountLabel
      ? `${taxDescription ?? "Sales Tax"}: ${taxAmountLabel}`
      : null,
    `Total Paid: ${amountLabel}`,
    `Payment ID: ${paymentIntentId}`,
    resolvedReceiptUrl ? `Stripe Receipt: ${resolvedReceiptUrl}` : null,
  ].filter((line): line is string => Boolean(line));

  const logoAsset = loadLightLogo();
  const logoCid = "logo_light@testifi.ai";
  const inlineLogo: EmailAttachment = {
    content: logoAsset.base64,
    filename: "logo-light.png",
    type: logoAsset.mime,
    disposition: "inline",
    contentId: logoCid,
  };

  const noticeStyle =
    "margin-top:24px;padding:16px;background-color:#fff3cd;border:1px solid #ffe58f;border-left:4px solid #ffc107;border-radius:6px;color:#5c3d00;";
  const noticeHeadingStyle = "margin:0 0 8px 0;color:#5c3d00;font-weight:600;";
  const noticeBodyStyle = "margin:0;color:#5c3d00;";

  const bodyHtml = `
    <h2>Thank You for Your Purchase</h2>
    <p>Hi ${greetingName},</p>
    <p>We've added <strong>${creditsLabel} ${creditNoun}</strong> to your Testifi AI account.</p>
    <div class="receipt-details">
      <div class="receipt-row">
        <span class="receipt-label">Credits Added:</span>
        <span class="receipt-value">${creditsLabel}</span>
      </div>
      ${
        subtotalLabel
          ? `<div class="receipt-row">
        <span class="receipt-label">Subtotal (${creditsLabel} ${creditNoun}):</span>
        <span class="receipt-value">${subtotalLabel}</span>
      </div>`
          : ""
      }
      ${
        showTaxRow && taxAmountLabel
          ? `<div class="receipt-row">
        <span class="receipt-label">${taxDescription ?? "Sales Tax"}:</span>
        <span class="receipt-value">${taxAmountLabel}</span>
      </div>`
          : ""
      }
      <div class="receipt-row">
        <span class="receipt-label">Total Paid:</span>
        <span class="receipt-value">${amountLabel}</span>
      </div>
      <div class="payment-id">Payment ID: ${paymentIntentId}</div>
    </div>
      ${
        resolvedReceiptUrl
          ? `<div class="cta-wrap">
        <a href="${resolvedReceiptUrl}" class="btn">View Stripe Receipt</a>
        <p style="margin-top:8px;font-size:13px;">
          If the button does not work, copy and paste this link:
          <a href="${resolvedReceiptUrl}">${resolvedReceiptUrl}</a>
        </p>
      </div>`
          : ""
      }
    <div class="notice" style="${noticeStyle}">
      <p style="${noticeHeadingStyle}"><strong>Important:</strong> Credits Expiration Policy</p>
      <p style="${noticeBodyStyle}">Credits must be used within 72 hours (3 days) from purchase. Unused credits will expire and cannot be recovered.</p>
    </div>
    <p>The credits are ready to use immediately. If you have any questions, reply to this email or contact <a href="mailto:support@testifi.ai">support@testifi.ai</a>.</p>
  `;

  const html = renderEmailShell({
    title: "Purchase Receipt",
    bodyHtml,
    theme: emailTheme,
    logoCid,
  });

  const text = `Hi ${greetingName},

Thank you for your purchase. We've added ${creditsLabel} ${creditNoun} to your Testifi AI account.

${breakdownLines.join("\n")}

Important: Credits Expiration Policy
Credits must be used within 72 hours (3 days) from purchase. Unused credits will expire and cannot be recovered.

The credits are ready to use immediately. If you have any questions, reply to this email or contact support@testifi.ai.

© ${new Date().getFullYear()} Testifi AI. All rights reserved.
You're receiving this because you made a purchase on Testifi AI.`;

  await sendEmail(user.email, subject, text, html, [inlineLogo]);
  console.log(`[purchase-receipt] Sent receipt email to ${user.email}`);
}

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
): Promise<{ purchase: Purchase; ledgerCreated: boolean }> {
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
  if (existing) {
    return { purchase, ledgerCreated: false };
  }

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

  return { purchase, ledgerCreated: true };
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

  const enrichedIntent = await ensureIntentHasReceiptData(intent);
  const amountCents = enrichedIntent.amount_received ?? enrichedIntent.amount ?? 0;
  const currency = enrichedIntent.currency ?? "usd";
  const paymentIntentId = intent.id;
  const receiptUrl = extractReceiptUrl(enrichedIntent);
  const subtotalCents = computeSubtotalCents(credits);
  const taxCents = deriveTaxCents({
    totalCents: amountCents,
    subtotalCents,
    taxOverrideCents: parsePositiveInt(enrichedIntent.metadata?.taxCents),
  });
  const metadataTaxLabel =
    typeof enrichedIntent.metadata?.taxLabel === "string" ? enrichedIntent.metadata.taxLabel : undefined;

  const recordResult = await prisma.$transaction(async (tx) => {
    return recordPurchaseCredit(tx, {
      paymentIntentId,
      userId,
      credits,
      amountCents,
      currency,
      receiptUrl,
    });
  });

  if (recordResult?.ledgerCreated) {
    try {
      await sendPurchaseReceiptEmail({
        userId,
        credits: recordResult.purchase.creditsAdded,
        amountCents: recordResult.purchase.amountCents,
        currency: recordResult.purchase.currency,
        receiptUrl: recordResult.purchase.receiptUrl ?? receiptUrl ?? undefined,
        paymentIntentId,
        subtotalCents,
        taxCents,
        taxLabel: metadataTaxLabel,
      });
    } catch (emailErr) {
      console.error("[purchase-receipt] Failed to send payment_intent receipt:", emailErr);
    }
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
  let paymentIntent: Stripe.PaymentIntent | null = null;
  try {
    paymentIntent = (await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    })) as Stripe.PaymentIntent;
  } catch (err) {
    console.warn(`[purchase-receipt] Unable to retrieve payment intent ${paymentIntentId}`, err);
  }

  const amountCents =
    paymentIntent?.amount_received ??
    paymentIntent?.amount ??
    session.amount_total ??
    session.amount_subtotal ??
    0;
  const currency = paymentIntent?.currency ?? session.currency ?? "usd";
  const receiptUrl = paymentIntent ? extractReceiptUrl(paymentIntent) : null;
  const sessionSubtotalCents = session.amount_subtotal ?? null;
  const subtotalCents = sessionSubtotalCents ?? computeSubtotalCents(credits);
  const taxCents = deriveTaxCents({
    totalCents: amountCents,
    subtotalCents,
    taxOverrideCents: session.total_details?.amount_tax ?? null,
  });
  const metadataTaxLabel =
    typeof paymentIntent?.metadata?.taxLabel === "string" ? paymentIntent.metadata.taxLabel : undefined;

  const recordResult = await prisma.$transaction(async (tx) => {
    return recordPurchaseCredit(tx, {
      paymentIntentId,
      userId,
      credits,
      amountCents,
      currency,
      receiptUrl,
    });
  });

  if (recordResult?.ledgerCreated) {
    try {
      await sendPurchaseReceiptEmail({
        userId,
        credits: recordResult.purchase.creditsAdded,
        amountCents: recordResult.purchase.amountCents,
        currency: recordResult.purchase.currency,
        receiptUrl: recordResult.purchase.receiptUrl ?? receiptUrl ?? undefined,
        paymentIntentId,
        subtotalCents,
        taxCents,
        taxLabel: metadataTaxLabel,
      });
    } catch (emailErr) {
      console.error("[purchase-receipt] Failed to send checkout receipt:", emailErr);
    }
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
  const {
    amountCents,
    credits,
    taxCents,
    taxLabel,
  } = req.body as { amountCents?: number; credits?: number; taxCents?: number; taxLabel?: string | null };

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
      ...(typeof taxCents === "number" ? { taxCents: String(Math.max(taxCents, 0)) } : {}),
      ...(taxLabel ? { taxLabel } : {}),
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

  res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
});

router.post(
  "/update-payment-intent",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId as string | undefined;
      const { paymentIntentId, amountCents, credits, taxCents, taxLabel } = req.body as {
        paymentIntentId?: string;
        amountCents?: number;
        credits?: number;
        taxCents?: number;
        taxLabel?: string | null;
      };

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (!paymentIntentId || !amountCents || amountCents <= 0) {
        res.status(400).json({ error: "paymentIntentId and positive amountCents are required" });
        return;
      }

      const currentIntent = (await stripe.paymentIntents.retrieve(paymentIntentId)) as Stripe.PaymentIntent;
      const ownerId = currentIntent.metadata?.userId;
      if (!ownerId || ownerId !== userId) {
        res.status(403).json({ error: "Payment intent does not belong to this user" });
        return;
      }

      const normalizedCredits =
        typeof credits === "number" && credits > 0 ? credits : parsePositiveInt(currentIntent.metadata?.credits ?? "");

      const metadataUpdate: Record<string, string> = {
        ...currentIntent.metadata,
        userId,
      };
      if (normalizedCredits) metadataUpdate.credits = String(normalizedCredits);
      if (typeof taxCents === "number") metadataUpdate.taxCents = String(Math.max(taxCents, 0));
      if (taxLabel) metadataUpdate.taxLabel = taxLabel;

      const updatedIntent = await stripe.paymentIntents.update(paymentIntentId, {
        amount: amountCents,
        metadata: metadataUpdate,
      });

      await prisma.purchase.upsert({
        where: { stripePaymentIntentId: paymentIntentId },
        update: {
          userId,
          amountCents,
          creditsAdded: normalizedCredits ?? 0,
          status: "requires_payment_method",
        },
        create: {
          userId,
          stripePaymentIntentId: paymentIntentId,
          amountCents,
          creditsAdded: normalizedCredits ?? 0,
          currency: "usd",
          status: "requires_payment_method",
        },
      });

      res.json({ clientSecret: updatedIntent.client_secret });
    } catch (err: any) {
      console.error("[POST /api/purchase/update-payment-intent] error", err);
      res.status(500).json({ error: err?.message || "Failed to update payment intent" });
    }
  }
);

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

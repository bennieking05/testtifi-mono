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

// Tiered pricing helper (matches frontend logic)
function getTierPricing(quantity: number): number {
  if (quantity >= 50) return 100.0;
  if (quantity >= 25) return 110.0;
  if (quantity >= 10) return 120.0;
  return 125.0; // 1–9 credits
}

// Track emails sent to prevent duplicates (in-memory cache, cleared on restart)
const emailSentCache = new Set<string>();

async function sendPurchaseReceiptEmail({
  userId,
  credits,
  amountCents,
  currency,
  paymentIntentId,
  receiptUrl,
  taxAmountCents,
}: {
  userId: string;
  credits: number;
  amountCents: number;
  currency: string;
  paymentIntentId: string;
  receiptUrl?: string | null;
  taxAmountCents?: number;
}): Promise<void> {
  try {
    // Check if we've already sent an email for this payment intent
    if (emailSentCache.has(paymentIntentId)) {
      console.log(`[purchase-receipt] Email already sent for payment intent ${paymentIntentId}, skipping`);
      return;
    }

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

    // Calculate subtotal and tax
    // Get the actual purchase record to verify credits and amount
    const purchase = await prisma.purchase.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    
    // Use credits from purchase record if available (more reliable than metadata)
    const actualCredits = purchase?.creditsAdded ?? credits;
    const unitPrice = getTierPricing(actualCredits);
    const subtotal = unitPrice * actualCredits;
    const totalAmount = amountCents / 100;
    
    // Use tax from Stripe if available, otherwise calculate as difference
    // But ensure tax is reasonable (not more than 20% of subtotal)
    let taxAmount = taxAmountCents !== undefined 
      ? taxAmountCents / 100 
      : totalAmount - subtotal;
    
    // Sanity check: if tax seems unreasonable, recalculate properly
    if (taxAmount > subtotal * 0.2) {
      // Tax is more than 20% - likely a calculation error
      // Recalculate tax properly (8.25% for Texas)
      const expectedTax = subtotal * 0.0825;
      const expectedTotal = subtotal + expectedTax;
      
      // If the total matches expected total with tax, use calculated tax
      if (Math.abs(totalAmount - expectedTotal) < 1) {
        taxAmount = expectedTax;
      } else {
        // Otherwise, use the difference but log a warning
        console.warn(`[receipt-email] Unusual tax calculation for payment ${paymentIntentId}: tax=${taxAmount}, subtotal=${subtotal}, total=${totalAmount}`);
        taxAmount = totalAmount - subtotal;
      }
    }
    
    // Always show tax line
    const hasTax = Math.abs(taxAmount) > 0.001;

    const currencyFormatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    });

    const subtotalFormatted = currencyFormatter.format(subtotal);
    const taxFormatted = hasTax ? currencyFormatter.format(taxAmount) : "$0.00";
    const totalFormatted = currencyFormatter.format(totalAmount);

    const subject = `Receipt: ${actualCredits} summary credit${actualCredits === 1 ? "" : "s"} added to your Testifi AI account`;
    const greetingName = user.name?.split(" ")[0] ?? "there";
    // Use hosted logo URL - this works in emails and is more reliable than embedding
    const logoSrc = "https://app.testifi.ai/testifi_dark_logo.png";

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Receipt</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .wrapper {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background-color: #5674BC;
      padding: 24px 16px;
      text-align: center;
    }
    .header img {
      max-width: 200px;
      height: auto;
    }
    .content {
      padding: 32px 24px;
    }
    .content h2 {
      color: #333;
      margin-top: 0;
      margin-bottom: 20px;
      font-size: 24px;
    }
    .content p {
      margin: 16px 0;
      color: #555;
    }
    .receipt-details {
      background-color: #f9f9f9;
      border-radius: 6px;
      padding: 20px;
      margin: 24px 0;
    }
    .receipt-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .receipt-row:last-child {
      border-bottom: none;
      font-weight: bold;
      font-size: 18px;
      padding-top: 12px;
      margin-top: 8px;
      border-top: 2px solid #5674BC;
    }
    .receipt-label {
      color: #666;
    }
    .receipt-value {
      color: #333;
      font-weight: 500;
    }
    .payment-id {
      font-size: 12px;
      color: #888;
      margin-top: 12px;
    }
    .cta-wrap {
      text-align: center;
      margin: 28px 0;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background-color: #5674BC;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
    }
    .btn:hover {
      background-color: #4563a3;
      color: #ffffff !important;
    }
    .retention-notice {
      margin-top: 24px;
      padding: 16px;
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
    }
    .retention-notice p {
      margin: 0;
      color: #856404;
    }
    .retention-notice p:first-child {
      font-weight: bold;
      margin-bottom: 8px;
    }
    .footer {
      background-color: #f7f7f7;
      color: #888;
      font-size: 13px;
      text-align: center;
      padding: 24px 16px;
      border-top: 1px solid #e0e0e0;
    }
    .footer p {
      margin: 4px 0;
      line-height: 1.5;
    }
    @media (max-width: 600px) {
      .wrapper {
        border-radius: 0;
      }
      .content {
        padding: 24px 16px;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <img src="${logoSrc}" alt="Testifi AI" style="display: block; margin: 0 auto; max-width: 200px; height: auto;" />
    </div>
    <div class="content">
      <h2>Thank You for Your Purchase</h2>
      <p>Hi ${greetingName},</p>
      <p>Thank you for your purchase. We've added <strong>${actualCredits.toLocaleString()} summary credit${actualCredits === 1 ? "" : "s"}</strong> to your Testifi AI account.</p>
      
      <div class="receipt-details">
        <div class="receipt-row">
          <span class="receipt-label">Subtotal (${actualCredits} credit${actualCredits === 1 ? "" : "s"}):</span>
          <span class="receipt-value">${subtotalFormatted}</span>
        </div>
        ${hasTax ? `
        <div class="receipt-row">
          <span class="receipt-label">Texas Sales Tax (8.25%):</span>
          <span class="receipt-value">${taxFormatted}</span>
        </div>
        ` : `
        <div class="receipt-row">
          <span class="receipt-label">Tax:</span>
          <span class="receipt-value">$0.00</span>
        </div>
        `}
        <div class="receipt-row">
          <span class="receipt-label">Total:</span>
          <span class="receipt-value">${totalFormatted}</span>
        </div>
        <div class="payment-id">
          Payment ID: ${paymentIntentId}
        </div>
      </div>

      ${receiptUrl ? `
      <div class="cta-wrap">
        <a href="${receiptUrl}" class="btn">Download Stripe Receipt</a>
      </div>
      ` : ""}

      <div class="retention-notice">
        <p><strong>Important:</strong> Credits Expiration Policy</p>
        <p>Credits must be used within 72 hours (3 days) from now. Any unused credits will expire and cannot be recovered. Please use your credits before they expire.</p>
      </div>

      <p>The credits are ready to use immediately. If you have any questions, reply to this email or contact <a href="mailto:support@testifi.ai">support@testifi.ai</a>.</p>
    </div>
    <div class="footer">
      <p><strong>Testifi AI</strong></p>
      <p>P.O. Box 600876</p>
      <p>Dallas, TX 75360-0876</p>
      <p style="margin-top: 16px;"><strong>© ${new Date().getFullYear()} Testifi AI. All rights reserved.</strong></p>
      <p style="margin-top: 8px;">You're receiving this because you made a purchase on Testifi AI.</p>
    </div>
  </div>
</body>
</html>`;

    // Generate text version of email
    const text = `Thank You for Your Purchase

Hi ${greetingName},

Thank you for your purchase. We've added ${actualCredits.toLocaleString()} summary credit${actualCredits === 1 ? "" : "s"} to your Testifi AI account.

Receipt Details:
- Subtotal (${actualCredits} credit${actualCredits === 1 ? "" : "s"}): ${subtotalFormatted}
${hasTax ? `- Texas Sales Tax (8.25%): ${taxFormatted}` : `- Tax: $0.00`}
- Total: ${totalFormatted}
- Payment ID: ${paymentIntentId}

${receiptUrl ? `Download your Stripe receipt: ${receiptUrl}\n\n` : ""}Important: Credits Expiration Policy\nCredits must be used within 72 hours (3 days) from now. Any unused credits will expire and cannot be recovered. Please use your credits before they expire.\n\nThe credits are ready to use immediately. If you have any questions, reply to this email or contact support@testifi.ai.

Testifi AI
P.O. Box 600876
Dallas, TX 75360-0876

© ${new Date().getFullYear()} Testifi AI. All rights reserved.
You're receiving this because you made a purchase on Testifi AI.`;

    // Log email details for debugging
    console.log(`[purchase-receipt] Sending email to ${user.email}:`, {
      subject,
      hasHtml: !!html,
      htmlLength: html.length,
      logoUrl: logoSrc,
      receiptUrl: receiptUrl || "none",
      actualCredits,
    });

    // Send styled HTML email with text fallback
    await sendEmail(user.email, subject, text, html);
    
    // Mark email as sent to prevent duplicates
    emailSentCache.add(paymentIntentId);
    
    // Clean up cache after 1 hour to prevent memory leaks
    setTimeout(() => {
      emailSentCache.delete(paymentIntentId);
    }, 60 * 60 * 1000);
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
  let credits = parsePositiveInt(intent.metadata?.credits ?? "");

  if (!userId) {
    throw new Error("Missing userId in payment intent metadata");
  }

  const amountCents = intent.amount_received ?? intent.amount ?? 0;
  const currency = intent.currency ?? "usd";
  const paymentIntentId = intent.id;
  const receiptUrl = (intent as any).charges?.data?.[0]?.receipt_url ?? null;
  
  // Try to get tax from Stripe's breakdown if available
  const taxAmountCents = (intent as any).amount_details?.amount_tax ?? null;

  // If credits not in metadata, try to get from purchase record (in case metadata wasn't updated)
  if (!credits) {
    const existingPurchase = await prisma.purchase.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (existingPurchase?.creditsAdded) {
      credits = existingPurchase.creditsAdded;
      console.log(`[webhook] Using credits from purchase record: ${credits}`);
    } else {
      throw new Error("Missing credits in payment intent metadata and purchase record");
    }
  }

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

  // Send email if this is a new purchase
  // If checkout.session.completed also fires, the email function will prevent duplicates
  if (created) {
    // Get the final credits from the purchase record to ensure accuracy
    const purchase = await prisma.purchase.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    const finalCredits = purchase?.creditsAdded ?? credits;
    
    console.log(`[webhook] Sending purchase receipt email for payment intent ${paymentIntentId}`);
    await sendPurchaseReceiptEmail({
      userId,
      credits: finalCredits,
      amountCents,
      currency,
      paymentIntentId,
      receiptUrl: receiptUrl ?? undefined,
      taxAmountCents: taxAmountCents ?? undefined,
    });
  } else {
    console.log(`[webhook] Purchase already processed for payment intent ${paymentIntentId}, skipping email`);
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
  
  // Get tax from Stripe's breakdown if available
  const taxAmountCents = (session.total_details as any)?.breakdown?.tax_total ?? null;

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

  // Only send email if this is a new purchase (not already processed)
  // This is the primary handler for sending purchase receipt emails
  // payment_intent.succeeded handler skips email to prevent duplicates
  if (created) {
    // Get the final credits from the purchase record to ensure accuracy
    const purchase = await prisma.purchase.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    const finalCredits = purchase?.creditsAdded ?? credits;
    
    console.log(`[webhook] Sending purchase receipt email for payment intent ${paymentIntentId}`);
    await sendPurchaseReceiptEmail({
      userId,
      credits: finalCredits,
      amountCents,
      currency,
      paymentIntentId,
      receiptUrl,
      taxAmountCents: taxAmountCents ?? undefined,
    });
  } else {
    console.log(`[webhook] Purchase already processed for payment intent ${paymentIntentId}, skipping email`);
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
        const session = event.data.object as Stripe.Checkout.Session;
        // Fetch full session with line items to get tax breakdown
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items', 'total_details.breakdown']
        });
        await handleCheckoutSessionCompleted(fullSession);
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
    description: `Deposition summary token(s) - ${credits} credit${credits === 1 ? "" : "s"}`,
    statement_descriptor_suffix: "TESTIFI AI",
    // Don't set receipt_email - Stripe will send automatic receipt, but we send our own styled email
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

  res.json({ 
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  });
});

router.post("/update-payment-intent", authenticateToken, async (req: Request, res: Response) => {
  const userId = (req as any).user.userId as string;
  const { paymentIntentId, amountCents, credits } = req.body as { 
    paymentIntentId?: string; 
    amountCents?: number;
    credits?: number;
  };

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!paymentIntentId || !amountCents) {
    res.status(400).json({ error: "Missing paymentIntentId or amountCents" });
    return;
  }

  try {
    // Verify the payment intent belongs to this user
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const intentUserId = intent.metadata?.userId;
    
    if (!intentUserId || intentUserId !== userId) {
      res.status(403).json({ error: "PaymentIntent does not belong to this user" });
      return;
    }

    // Only allow updates if payment intent is in a mutable state
    if (intent.status !== "requires_payment_method" && intent.status !== "requires_confirmation") {
      res.status(400).json({ 
        error: `Cannot update PaymentIntent in status: ${intent.status}`,
        status: intent.status 
      });
      return;
    }

    // Update the payment intent amount and metadata (credits if provided)
    const updateData: Stripe.PaymentIntentUpdateParams = {
      amount: amountCents,
    };
    
    if (credits !== undefined) {
      updateData.metadata = {
        ...intent.metadata,
        credits: String(credits),
      };
    }

    const updatedIntent = await stripe.paymentIntents.update(paymentIntentId, updateData);

    // Update the purchase record
    await prisma.purchase.update({
      where: { stripePaymentIntentId: paymentIntentId },
      data: {
        amountCents,
        ...(credits !== undefined ? { creditsAdded: credits } : {}),
      },
    });

    res.json({ 
      clientSecret: updatedIntent.client_secret,
      paymentIntentId: updatedIntent.id,
    });
  } catch (error: any) {
    console.error("[update-payment-intent] Error:", error);
    res.status(500).json({ 
      error: "Failed to update payment intent",
      details: error.message 
    });
  }
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

      let intent: Stripe.PaymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
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
            intent = refreshedIntent;
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

      // Note: Stripe's automatic receipts are controlled in Dashboard Settings
      // They cannot be disabled programmatically per payment
      // To disable: Dashboard → Settings → Business settings → Customer emails → Toggle off "Successful payments"

      // Send email if this is a new purchase
      // The emailSentCache will prevent duplicates if webhook also fires
      if (created) {
        // Get the final credits from the purchase record to ensure accuracy
        const purchase = await prisma.purchase.findUnique({
          where: { stripePaymentIntentId: paymentIntentId },
        });
        const finalCredits = purchase?.creditsAdded ?? credits;
        
        // Try to get tax from Stripe's breakdown if available
        const taxAmountCents = (intent as any).amount_details?.amount_tax ?? null;
        
        console.log(`[confirm] Sending purchase receipt email for payment intent ${paymentIntentId}`);
        await sendPurchaseReceiptEmail({
          userId,
          credits: finalCredits,
          amountCents,
          currency,
          paymentIntentId,
          receiptUrl,
          taxAmountCents: taxAmountCents ?? undefined,
        });
      } else {
        console.log(`[confirm] Purchase already processed for payment intent ${paymentIntentId}, skipping email`);
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
    // Filter out legacy/manual credits that start with "legacy-"
    const purchases = await prisma.purchase.findMany({
      where: { 
        userId,
        stripePaymentIntentId: { not: { startsWith: "legacy-" } },
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

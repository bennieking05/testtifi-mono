import express, { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken, requireAdmin } from "../middlewares/authMiddleware";
import Stripe from "stripe";

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
  apiVersion: "2025-05-28.basil",
});

// helper to catch async errors
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

/**
 * POST /api/purchase/purchase-credits
 * Create a PaymentIntent & record a pending purchase.
 */
router.post(
  "/purchase-credits",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.userId as string;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { plan, tokens, amount } = req.body as {
      plan?: string;
      tokens?: number;
      amount?: number;
    };

    const planDetails: Record<
      string,
      { creditsToAdd: number; amount: number }
    > = {
      individual: { creditsToAdd: 1, amount: 12500 },
      basic: { creditsToAdd: 10, amount: 120000 },
      plus: { creditsToAdd: 25, amount: 275000 },
      premium: { creditsToAdd: 50, amount: 500000 },
    };

    let creditsToAdd: number;
    let finalAmount: number;

    if (plan === "custom") {
      if (
        typeof tokens !== "number" ||
        typeof amount !== "number" ||
        tokens < 1 ||
        amount <= 0
      ) {
        res.status(400).json({ error: "Invalid custom plan details" });
        return;
      }

      creditsToAdd = tokens;
      finalAmount = Math.round(amount * 100); // Convert to cents
    } else {
      const selected = planDetails[plan ?? ""];
      if (!selected) {
        console.warn("⚠️ Invalid plan sent from frontend:", plan);
        res.status(400).json({ error: "Invalid plan" });
        return;
      }

      creditsToAdd = selected.creditsToAdd;
      finalAmount = selected.amount;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: finalAmount,
      currency: "usd",
      description: `Purchase ${creditsToAdd} credits for user ${userId}`,
      metadata: {
        userId,
        credits: String(creditsToAdd),
        plan: plan ?? "custom",
      },
    });

    await prisma.purchase.create({
      data: {
        id: paymentIntent.id,
        userId,
        credits: creditsToAdd,
        amount: finalAmount,
        success: false,
      },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  })
);

/**
 * POST /api/purchase/complete
 * Manually finalize a pending purchase.
 */
router.post(
  "/complete",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.userId as string;
    const { paymentIntentId } = req.body as { paymentIntentId?: string };
    if (!paymentIntentId) {
      res.status(400).json({ error: "Missing paymentIntentId" });
      return;
    }

    const purchase = await prisma.purchase.findUnique({
      where: { id: paymentIntentId },
    });
    if (!purchase) {
      res.status(404).json({ error: "Purchase not found" });
      return;
    }

    if (!purchase.success) {
      await prisma.purchase.update({
        where: { id: paymentIntentId },
        data: { success: true },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: purchase.credits } },
      });
    }

    res.json({ ok: true, creditsAdded: purchase.credits });
  })
);

/**
 * This handler is exported so we can mount it *before* express.json()
 * in server.ts, using bodyParser.raw().
 */
export const stripeWebhookHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw Buffer
      req.headers["stripe-signature"] as string,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature error:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (
    event.type === "payment_intent.succeeded" ||
    event.type === "payment_intent.payment_failed"
  ) {
    const pi = event.data.object as Stripe.PaymentIntent;
    const { userId, credits: creditsStr } = pi.metadata;
    const creditsToAdd = parseInt(creditsStr as string, 10);
    const success = event.type === "payment_intent.succeeded";

    try {
      await prisma.purchase.update({
        where: { id: pi.id },
        data: { success },
      });
      if (success) {
        await prisma.user.update({
          where: { id: userId as string },
          data: { credits: { increment: creditsToAdd } },
        });
      }
    } catch (dbErr) {
      console.error("DB update error:", dbErr);
    }
  }

  res.json({ received: true });
};

/**
 * GET /api/purchase/history
 *   – admin only: return all past purchases with user info
 */
router.get(
  "/history",
  authenticateToken,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = await prisma.purchase.findMany({
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, email: true } } },
      });

      const history = raw.map(
        (p: {
          id: any;
          user: { name: any; email: any };
          createdAt: { toISOString: () => any };
          credits: any;
          amount: any;
        }) => ({
          id: p.id,
          user: p.user.name,
          email: p.user.email,
          date: p.createdAt.toISOString(),
          plan: `${p.credits} Credits`,
          amount: p.amount,
        })
      );

      res.json(history);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

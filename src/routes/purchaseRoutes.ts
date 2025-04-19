import express, { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import Stripe from "stripe";
import bodyParser from "body-parser";

// Initialize Stripe with your API key and the correct API version.
const stripe = new Stripe(process.env.STRIPE_API_KEY as string, {
  apiVersion: "2025-03-31.basil",
});

const prisma = new PrismaClient();
const router = express.Router();

// Helper to wrap async handlers that must return Promise<void>
const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction): Promise<void> =>
    fn(req, res, next).catch((err) => {
      next(err);
      return;
    });
};

/**
 * POST /purchase-credits
 * Validates the plan and creates a PaymentIntent on Stripe.
 * Returns the client secret to complete payment on the client.
 */
router.post(
  "/purchase-credits",
  authenticateToken,
  asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { plan } = req.body;
      let creditsToAdd: number;
      let amount: number;

      /**
       * Match front-end plans:
       *   - individual => 1 credit => $125
       *   - basic      => 10 credits => $1000
       *   - plus       => 25 credits => $2500
       *   - premium    => 50 credits => $5000
       */
      if (plan === "individual") {
        creditsToAdd = 1;
        amount = 125.0;
      } else if (plan === "basic") {
        creditsToAdd = 10;
        amount = 1000.0;
      } else if (plan === "plus") {
        creditsToAdd = 25;
        amount = 2500.0;
      } else if (plan === "premium") {
        creditsToAdd = 50;
        amount = 5000.0;
      } else {
        res.status(400).json({ error: "Invalid plan" });
        return;
      }

      // Verify that the user exists in the DB.
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      try {
        // Create a Stripe PaymentIntent with the amount in cents.
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // convert dollars to cents
          currency: "usd",
          description: `Purchase ${creditsToAdd} credits for user ${userId}`,
          metadata: {
            userId,
            credits: String(creditsToAdd),
            plan,
          },
        });

        // Return the PaymentIntent client secret to the client.
        res.json({ clientSecret: paymentIntent.client_secret });
        return;
      } catch (err) {
        console.error("Error creating PaymentIntent:", err);
        res.status(500).json({ error: "Failed to create PaymentIntent" });
        return;
      }
    }
  )
);

/**
 * POST /stripe-webhook
 * Handles Stripe events using a raw JSON body parser.
 * Records the purchase transaction regardless of success or failure.
 * On payment success, updates the user’s credits.
 */
router.post(
  "/stripe-webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET as string
      );
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    console.log("Received Stripe event:", event.type);

    // Process both succeeded and failed payment events.
    if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed"
    ) {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const metadata = paymentIntent.metadata;
      const userId = metadata.userId;
      const creditsToAdd = parseInt(metadata.credits);
      // Use the original amount (always set by Stripe) for both success and failure.
      const amount = paymentIntent.amount / 100;
      const success = event.type === "payment_intent.succeeded";

      console.log("Processing PaymentIntent:", paymentIntent.id, {
        userId,
        creditsToAdd,
        amount,
        success,
      });

      try {
        // Check if a purchase has already been recorded for this PaymentIntent.
        const existingPurchase = await prisma.purchase.findUnique({
          where: { id: paymentIntent.id },
        });

        if (!existingPurchase) {
          // If the payment succeeded, update the user's credits.
          if (success) {
            const user = await prisma.user.findUnique({
              where: { id: userId },
            });
            if (user) {
              const newCredits = (user.credits || 0) + creditsToAdd;
              await prisma.user.update({
                where: { id: userId },
                data: { credits: newCredits },
              });
              console.log(`Updated user (${userId}) credits to: ${newCredits}`);
            } else {
              console.error("User not found during webhook processing.");
            }
          }

          // Record the purchase transaction with the success field.
          await prisma.purchase.create({
            data: {
              id: paymentIntent.id,
              userId,
              credits: creditsToAdd,
              amount: amount,
              success: success,
            },
          });
          console.log(
            "Purchase record created for PaymentIntent:",
            paymentIntent.id
          );
        } else {
          console.log(
            "Purchase record already exists for PaymentIntent:",
            paymentIntent.id
          );
        }
      } catch (err) {
        console.error("Error processing purchase record:", err);
      }
    }

    res.json({ received: true });
    return;
  }
);

export default router;

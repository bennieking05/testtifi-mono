import express from "express";
import Stripe from "stripe";

const router = express.Router();

const stripeKey = process.env.STRIPE_API_KEY || "";
const stripe = stripeKey
  ? new Stripe(stripeKey, { apiVersion: "2025-09-30.clover" })
  : null;

router.get("/stripe-account", async (_req, res) => {
  if (!stripe) {
    res.status(500).json({ error: "STRIPE_API_KEY not set" });
    return;
  }
  try {
    const account = await stripe.accounts.retrieve();
    res.json({ accountId: account.id });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? String(error) });
  }
});

router.get("/stripe-key-prefix", (_req, res) => {
  const key = process.env.STRIPE_API_KEY;
  res.json({ keyPrefix: key ? key.slice(0, 16) : null });
});

export default router;


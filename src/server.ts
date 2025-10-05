import express, { type RequestHandler } from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import authRoutes from "./routes/authRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import purchaseRoutes, { stripeWebhookHandler } from "./routes/purchaseRoutes";
import billingRoutes from "./routes/billingRoutes";
import downloadRoutes from "./routes/downloadRoutes";
import userRoutes from "./routes/userRoutes";
import supportRoutes from "./routes/supportRoutes";
import fineTineRoutes from "./routes/fineTuneRoutes";
import summariesRoutes from "./routes/summariesRoutes";
import summaryJobRoutes from "./routes/summaryJobRoutes";
import previeqwRoutes from "./routes/previewRoutes";
import emailNotificationRoutes from "./routes/emailNotificationRoutes";
import snapshotsRoutes from "./routes/snapshotsRoutes";
import webCopyRoutes from "./routes/webCopyRoutes";
import validationRoutes from "./routes/validationRoutes";
import adminRoutes from "./routes/adminRoutes";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

/* ─────────────── HEALTH CHECKS ──────────────── */
const health: RequestHandler = (_req, res) => {
  console.log("✔️  /health check received");
  res.status(200).send("OK");
};

app.get("/health", health); // k8s liveness / readiness
app.get("/api/health", health); // public Ingress

// Emergency endpoint to reset stuck jobs (no auth required)
app.post("/api/emergency/reset-stuck-jobs", async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    const result = await prisma.summaryJob.updateMany({
      where: { 
        status: 'processing',
        id: { in: ['a98dffa1-d1dc-4cd3-ad03-fc63e887f3f0', 'e0c176c8-69c9-47fa-a898-76a56974062b'] }
      },
      data: { status: 'queued' }
    });
    
    await prisma.$disconnect();
    res.json({ message: `Reset ${result.count} stuck jobs to queued status` });
  } catch (error) {
    console.error("Emergency reset error:", error);
    res.status(500).json({ error: error.message });
  }
});

/* ─────────────── MIDDLEWARE ─────────────────── */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post(
  "/api/purchase/stripe-webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhookHandler
);

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ─────────────── ROUTES ─────────────────────── */
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/summaries", summariesRoutes);
app.use("/api/download", downloadRoutes);
app.use("/api/user", userRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/fine-tune", fineTineRoutes);
app.use("/api/summary-jobs", summaryJobRoutes);
app.use("/api/email-notifications", emailNotificationRoutes);
app.use("/api/preview", previeqwRoutes);
app.use("/api/snapshots", snapshotsRoutes);
app.use("/api/webcopy", webCopyRoutes);
app.use("/api/validation", validationRoutes);
app.use("/api/admin", adminRoutes);

/* ─────────────── START SERVER ───────────────── */
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✔️  Backend listening on port ${PORT}`)
);

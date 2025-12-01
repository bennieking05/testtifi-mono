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
import debugRoutes from "./routes/debugRoutes";
import cleanupRoutes from "./routes/cleanupRoutes";
import assetsRoutes from "./routes/assetsRoutes";
import { startCreditExpirationJob } from "./jobs/creditExpirationJob";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

startCreditExpirationJob();

/* ─────────────── HEALTH CHECKS ──────────────── */
const health: RequestHandler = (_req, res) => {
  console.log("✔️  /health check received");
  res.status(200).send("OK");
};

app.get("/health", health); // k8s liveness / readiness
app.get("/api/health", health); // public Ingress

// Stripe webhook must be registered BEFORE any body-parsing middleware
// so we can access the raw body for signature verification
app.post(
  "/api/purchase/stripe-webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// Test endpoint for debugging
app.post("/api/test", (req, res) => {
  console.log("Test endpoint hit:", req.body);
  res.json({ message: "Test successful", body: req.body });
});

// Emergency endpoint to reset stuck jobs (no auth required)
app.post("/api/emergency/reset-stuck-jobs", async (_req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    const result = await prisma.summaryJob.updateMany({
      where: { status: 'processing' },
      data: { status: 'queued' }
    });
    
    await prisma.$disconnect();
    res.json({ message: `Reset ${result.count} stuck jobs to queued status` });
  } catch (error: any) {
    console.error("Emergency reset error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Emergency endpoint to check job status (no auth required)
app.get("/api/emergency/job-status", async (_req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    const jobs = await prisma.summaryJob.findMany({
      where: { status: { in: ['queued', 'processing'] } },
      select: { id: true, status: true, fileName: true, createdAt: true, lastPageProcessed: true, totalPages: true }
    });
    
    await prisma.$disconnect();
    res.json({ jobs });
  } catch (error: any) {
    console.error("Job status error:", error);
    res.status(500).json({ error: error.message });
  }
});

/* ─────────────── MIDDLEWARE ─────────────────── */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Graceful JSON parse error handler so bad bodies don't crash routes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === "entity.parse.failed" || (err instanceof SyntaxError && (err as any).status === 400)) {
    res.status(400).json({ error: "INVALID_JSON" });
    return;
  }
  next(err);
});

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
app.use("/api/debug", debugRoutes);
app.use("/api/cleanup", cleanupRoutes);
app.use("/api/assets", assetsRoutes);

/* ─────────────── START SERVER ───────────────── */
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✔️  Backend listening on port ${PORT}`)
);

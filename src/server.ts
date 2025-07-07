import express, { type RequestHandler } from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import authRoutes from "./routes/authRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import purchaseRoutes, { stripeWebhookHandler } from "./routes/purchaseRoutes";
import downloadRoutes from "./routes/downloadRoutes";
import userRoutes from "./routes/userRoutes";
import supportRoutes from "./routes/supportRoutes";
import fineTineRoutes from "./routes/fineTuneRoutes";
import summariesRoutes from "./routes/summariesRoutes";
import summaryJobRoutes from "./routes/summaryJobRoutes";
import previeqwRoutes from "./routes/previewRoutes";
import emailNotificationRoutes from "./routes/emailNotificationRoutes";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

console.log("Starting backend...");
console.log("PORT:", PORT);
console.log("DATABASE_URL:", process.env.DATABASE_URL);
/* ─────────────── HEALTH CHECKS ──────────────── */
const health: RequestHandler = (_req, res) => {
  res.status(200).send("OK");
};

app.get("/health", health); // k8s liveness / readiness
app.get("/api/health", health); // public Ingress

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
app.use("/api/summaries", summariesRoutes);
app.use("/api/download", downloadRoutes);
app.use("/api/user", userRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/fine-tune", fineTineRoutes);
app.use("/api/summary-jobs", summaryJobRoutes);
app.use("/api/email-notifications", emailNotificationRoutes);
app.use("/api/preview", previeqwRoutes);

/* ─────────────── START SERVER ───────────────── */
setTimeout(() => {
  app.listen(PORT, "0.0.0.0", () =>
    console.log(`✔️  Backend listening on port ${PORT}`)
  );
}, 3000); // Wait 3 seconds before starting the server

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import authRoutes from "./routes/authRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import purchaseRoutes, { stripeWebhookHandler } from "./routes/purchaseRoutes";
import downloadRoutes from "./routes/downloadRoutes";
import userRoutes from "./routes/userRoutes";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

// Health check
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

app.use(cors());

// ┏━ 1) Mount the raw-body Stripe webhook BEFORE any JSON parser ━━━━━━━┓
app.post(
  "/api/purchase/stripe-webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhookHandler
);
// ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

// ┏━ 2) All other payloads should be JSON ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
app.use(express.json());
// ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

// ┏━ 3) Log all requests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
// ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

// ┏━ 4) Mount your routes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
app.use("/api/auth", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/summaries", downloadRoutes);
app.use("/api/user", userRoutes);
// ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

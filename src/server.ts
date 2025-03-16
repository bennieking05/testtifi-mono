import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import purchaseRoutes from "./routes/purchaseRoutes";
import downloadRoutes from "./routes/downloadRoutes";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/summaries", downloadRoutes);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

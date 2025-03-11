import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes"; // Ensure correct import path
import uploadRoutes from "./routes/uploadRoutes";
import purchaseRoutes from "./routes/purchaseRoutes";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api/purchase", purchaseRoutes);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

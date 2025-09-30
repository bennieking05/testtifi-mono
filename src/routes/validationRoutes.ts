import express from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import { runValidation } from "../controllers/validationController";

const router = express.Router();

router.post("/run", authenticateToken, runValidation);

export default router;



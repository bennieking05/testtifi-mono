import express from "express";
import { Request, Response, NextFunction } from "express";
import {
  register,
  login,
  forgotPassword,
  resetPassword,
  getResetEmail, //
} from "../controllers/authController"; // ✅ Use relative path

const router = express.Router();

// Helper function to catch async errors
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

// Corrected route handlers
router.post("/register", asyncHandler(register));
router.post("/login", asyncHandler(login));
router.post("/forgot-password", asyncHandler(forgotPassword));
router.post("/reset-password", asyncHandler(resetPassword));
router.get("/get-reset-email", asyncHandler(getResetEmail));

export default router;

import express from "express";
import { Response, NextFunction } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";

interface AuthRequest extends express.Request {
  user?: { userId: string; email: string };
}

const router = express.Router();

router.get(
  "/dashboard",
  authenticateToken,
  (req: AuthRequest, res: Response, _next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return; // ✅ Ensure function exits
    }

    res.json({ message: "Welcome to the dashboard!", user: req.user });
  }
);

export default router;

import express, { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // The auth middleware should attach the user info (like userId) to req.user
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      // Return only the necessary fields (e.g., credits, name, email)
      res.json({
        credits: user.credits,
        name: user.name,
        email: user.email,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

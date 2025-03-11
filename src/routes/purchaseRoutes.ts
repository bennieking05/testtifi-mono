import express, { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

const prisma = new PrismaClient();
const router = express.Router();

// Updated asyncHandler that ensures a Promise<void> is returned.
const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): Promise<void> =>
    Promise.resolve(fn(req, res, next))
      .then(() => undefined)
      .catch((err) => {
        next(err);
        return undefined;
      });
};

router.post(
  "/purchase-credits",
  authenticateToken,
  asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return undefined;
      }

      const { plan } = req.body;
      let creditsToAdd: number;
      let amount: number;

      if (plan === "basic") {
        creditsToAdd = 1;
        amount = 124.99;
      } else if (plan === "standard") {
        creditsToAdd = 3;
        amount = 299.99;
      } else if (plan === "premium") {
        creditsToAdd = 10;
        amount = 849.99;
      } else {
        res.status(400).json({ error: "Invalid plan" });
        return undefined;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return undefined;
      }

      const newCredits = (user.credits || 0) + creditsToAdd;

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { credits: newCredits },
      });

      // Record the purchase transaction
      await prisma.purchase.create({
        data: {
          userId,
          credits: creditsToAdd,
          amount,
        },
      });

      res.json({
        message: "Credits purchased successfully",
        credits: updatedUser.credits,
      });
      return undefined;
    }
  )
);

export default router;

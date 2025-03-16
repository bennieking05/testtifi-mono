import express, { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";

const prisma = new PrismaClient();
const router = express.Router();

// Helper to wrap async handlers
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
        return;
      }

      const { plan } = req.body;
      let creditsToAdd: number;
      let amount: number;

      /**
       * Match front-end plans:
       *   - individual => 1 credit => $125
       *   - basic      => 10 credits => $1000
       *   - plus       => 25 credits => $2500
       *   - premium    => 50 credits => $5000
       */
      if (plan === "individual") {
        creditsToAdd = 1;
        amount = 125.0;
      } else if (plan === "basic") {
        creditsToAdd = 10;
        amount = 1000.0;
      } else if (plan === "plus") {
        creditsToAdd = 25;
        amount = 2500.0;
      } else if (plan === "premium") {
        creditsToAdd = 50;
        amount = 5000.0;
      } else {
        res.status(400).json({ error: "Invalid plan" });
        return;
      }

      // Fetch user from DB
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Add new credits
      const newCredits = (user.credits || 0) + creditsToAdd;

      // Update user credits
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

      // Return updated credits
      res.json({
        message: "Credits purchased successfully",
        credits: updatedUser.credits,
      });
    }
  )
);

export default router;

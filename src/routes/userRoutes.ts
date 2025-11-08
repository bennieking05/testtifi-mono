// src/routes/userRoutes.ts

import express, { Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import {
  authenticateToken,
  requireAdmin,
  AuthRequest,
} from "../middlewares/authMiddleware";

const prisma = new PrismaClient();
const router = express.Router();

/**
 * GET /api/user
 * Returns the current user’s public profile.
 * ------------------------------------------------------------------
 * Response: { credits: number, name: string | null, email: string, role: "admin" | "user" }
 */
router.get(
  "/",
  authenticateToken,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true, name: true, email: true, role: true },
      });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json(user);
    } catch (err) {
      next(err as Error);
    }
  }
);

/**
 * GET /api/user/credits
 * Returns the current user's credit balance.
 * ------------------------------------------------------------------
 * Response: { credits: number }
 */
router.get(
  "/credits",
  authenticateToken,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ credits: user.credits });
    } catch (err) {
      next(err as Error);
    }
  }
);

/**
 * GET /api/users/signups
 * Admin only: returns all user sign‑ups.
 * ------------------------------------------------------------------
 * Response: Array<{
 *   id: string;
 *   name: string;
 *   email: string;
 *   company: string;
 *   date: string;      // ISO timestamp of creation
 *   status: "active";  // future: can reflect other statuses
 * }>
 */
router.get(
  "/signups",
  authenticateToken,
  requireAdmin,
  async (
    _req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          companyName: true,
          createdAt: true,
        },
      });

      const payload = users.map((u) => ({
        id: u.id,
        name: u.name ?? "",
        email: u.email,
        company: u.companyName ?? "",
        date: u.createdAt.toISOString(),
        status: "active" as const,
      }));

      res.json(payload);
    } catch (err) {
      next(err as Error);
    }
  }
);

export default router;

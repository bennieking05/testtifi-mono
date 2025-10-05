// backend/src/controllers/adminController.ts

import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import metricsService from "../services/metricsService";

export class AdminController {
  async getOverview(res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = await metricsService.getOverviewMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("[AdminController.getOverview] Error:", error);
      next(error);
    }
  }

  async getRevenueMetrics(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const period = (req.query.period as string) || "30d";
      if (!["7d", "30d", "90d", "all"].includes(period)) {
        res.status(400).json({ error: "Invalid period parameter" });
        return;
      }
      const metrics = await metricsService.getRevenueMetrics(period);
      res.json(metrics);
    } catch (error) {
      console.error("[AdminController.getRevenueMetrics] Error:", error);
      next(error);
    }
  }

  async getUserMetrics(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const period = (req.query.period as string) || "30d";
      if (!["7d", "30d", "90d", "all"].includes(period)) {
        res.status(400).json({ error: "Invalid period parameter" });
        return;
      }
      const metrics = await metricsService.getUserMetrics(period);
      res.json(metrics);
    } catch (error) {
      console.error("[AdminController.getUserMetrics] Error:", error);
      next(error);
    }
  }

  async getSummaryMetrics(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const period = (req.query.period as string) || "30d";
      if (!["7d", "30d", "90d", "all"].includes(period)) {
        res.status(400).json({ error: "Invalid period parameter" });
        return;
      }
      const metrics = await metricsService.getSummaryMetrics(period);
      res.json(metrics);
    } catch (error) {
      console.error("[AdminController.getSummaryMetrics] Error:", error);
      next(error);
    }
  }

  async getDownloadMetrics(
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const metrics = await metricsService.getDownloadMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("[AdminController.getDownloadMetrics] Error:", error);
      next(error);
    }
  }

  async getSupportMetrics(
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const metrics = await metricsService.getSupportMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("[AdminController.getSupportMetrics] Error:", error);
      next(error);
    }
  }

  async getSystemHealth(
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const metrics = await metricsService.getSystemHealthMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("[AdminController.getSystemHealth] Error:", error);
      next(error);
    }
  }

  async resetStuckJobs(
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      
      const result = await prisma.summaryJob.updateMany({
        where: { 
          status: 'processing',
          id: { in: ['a98dffa1-d1dc-4cd3-ad03-fc63e887f3f0', 'e0c176c8-69c9-47fa-a898-76a56974062b'] }
        },
        data: { status: 'queued' }
      });
      
      await prisma.$disconnect();
      res.json({ message: `Reset ${result.count} stuck jobs to queued status` });
    } catch (error) {
      console.error("[AdminController.resetStuckJobs] Error:", error);
      next(error);
    }
  }
}

export default new AdminController();



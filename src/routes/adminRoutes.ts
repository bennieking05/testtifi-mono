// backend/src/routes/adminRoutes.ts

import express from "express";
import { authenticateToken, requireAdmin } from "../middlewares/authMiddleware";
import adminController from "../controllers/adminController";

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * GET /api/admin/metrics/overview
 * Returns high-level KPIs for the admin dashboard
 */
router.get("/metrics/overview", (_req, res, next) => adminController.getOverview(res, next));

/**
 * GET /api/admin/metrics/revenue?period=30d
 * Returns detailed revenue metrics
 * Query params: period (7d, 30d, 90d, all)
 */
router.get("/metrics/revenue", adminController.getRevenueMetrics);

/**
 * GET /api/admin/metrics/users?period=30d
 * Returns user analytics and growth metrics
 * Query params: period (7d, 30d, 90d, all)
 */
router.get("/metrics/users", adminController.getUserMetrics);

/**
 * GET /api/admin/metrics/summaries?period=30d
 * Returns summary/product performance metrics
 * Query params: period (7d, 30d, 90d, all)
 */
router.get("/metrics/summaries", adminController.getSummaryMetrics);

/**
 * GET /api/admin/metrics/downloads
 * Returns download analytics
 */
router.get("/metrics/downloads", (_req, res, next) => adminController.getDownloadMetrics(res, next));

/**
 * GET /api/admin/metrics/support
 * Returns support ticket metrics
 */
router.get("/metrics/support", (_req, res, next) => adminController.getSupportMetrics(res, next));

/**
 * GET /api/admin/metrics/system-health
 * Returns system health and queue status
 */
router.get("/metrics/system-health", (_req, res, next) => adminController.getSystemHealth(res, next));

/**
 * POST /api/admin/reset-stuck-jobs
 * Resets stuck processing jobs to queued status
 */
router.post("/reset-stuck-jobs", (_req, res, next) => adminController.resetStuckJobs(res, next));

export default router;


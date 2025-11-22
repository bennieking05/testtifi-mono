// ─── src/routes/cleanupRoutes.ts ────────────────────────────────────────────
// Routes for manual cleanup of old summaries (admin only)

import express, { Request, Response } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import { cleanupOldSummaries } from "../services/summaryCleanupService";

const router = express.Router();

/**
 * POST /api/cleanup/summaries
 * Manually trigger cleanup of summaries older than 3 days
 * Admin only
 */
router.post(
  "/summaries",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Check if user is admin (you may need to adjust this based on your auth middleware)
      const user = (req as any).user;
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }

      const result = await cleanupOldSummaries();
      res.json({
        success: true,
        deleted: result.deleted,
        errors: result.errors,
        message: `Cleanup completed: ${result.deleted} summaries deleted, ${result.errors} errors`,
      });
    } catch (error: any) {
      console.error("[CleanupRoute] Error:", error);
      res.status(500).json({ error: "Failed to run cleanup", details: error.message });
    }
  }
);

export default router;





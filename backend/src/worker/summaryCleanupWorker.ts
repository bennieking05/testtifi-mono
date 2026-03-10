// ─── src/worker/summaryCleanupWorker.ts ────────────────────────────────────────
// Worker to periodically clean up summaries older than 3 days

import dotenv from "dotenv";
dotenv.config();

import { runCleanup } from "../services/summaryCleanupService";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run every hour

console.log("🧹 Summary Cleanup Worker starting...");
console.log(`[SummaryCleanupWorker] Will run cleanup every ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes`);

async function work() {
  while (true) {
    try {
      await runCleanup();
    } catch (error: any) {
      console.error("[SummaryCleanupWorker] Error in cleanup cycle:", error);
    }
    
    // Wait before next cleanup cycle
    await new Promise((resolve) => setTimeout(resolve, CLEANUP_INTERVAL_MS));
  }
}

// Start the worker
work().catch((error) => {
  console.error("[SummaryCleanupWorker] Fatal error:", error);
  process.exit(1);
});





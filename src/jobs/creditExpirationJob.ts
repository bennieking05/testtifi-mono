import { PrismaClient } from "@prisma/client";
import { expireUnusedCredits } from "../billing/creditExpiration";

const prisma = new PrismaClient();
const DEFAULT_INTERVAL_MS = Number(
  process.env.CREDIT_EXPIRATION_INTERVAL_MS ?? 60 * 60 * 1000
);

let timer: NodeJS.Timeout | null = null;

async function runExpirationOnce(): Promise<void> {
  try {
    const summary = await expireUnusedCredits(prisma);
    if (summary.creditsExpired > 0) {
      console.log(
        `[credit-expiration] Expired ${summary.creditsExpired} credits from ${summary.purchasesExpired} purchase(s)`
      );
    }
  } catch (error) {
    console.error("[credit-expiration] Failed to expire credits:", error);
  }
}

export function startCreditExpirationJob(): void {
  if (process.env.DISABLE_CREDIT_EXPIRATION_JOB === "1") {
    console.log("[credit-expiration] Job disabled via env");
    return;
  }
  if (timer) return; // already scheduled

  runExpirationOnce().catch(() => {});
  timer = setInterval(() => {
    runExpirationOnce().catch(() => {});
  }, DEFAULT_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

export async function stopCreditExpirationJob(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await prisma.$disconnect().catch(() => {});
}



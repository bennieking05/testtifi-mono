import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateUserCredits(userId: string) {
  try {
    // Get user's current credits from User table
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true, email: true },
    });

    if (!user) {
      console.log(`❌ User ${userId} not found`);
      return;
    }

    console.log(`Found user: ${user.email} with ${user.credits} credits`);

    if (user.credits === 0) {
      console.log("✅ No credits to migrate");
      return;
    }

    // Check if already migrated
    const existingEntry = await prisma.ledgerEntry.findFirst({
      where: {
        userId,
        idempotencyKey: `migration:user-credits:${userId}`,
      },
    });

    if (existingEntry) {
      console.log("✅ Credits already migrated to ledger system");
      return;
    }

    // Create a credit entry in the ledger
    await prisma.$transaction(async (tx) => {
      // First create a purchase record for the migration
      const purchase = await tx.purchase.create({
        data: {
          userId,
          amount: 0, // Free migration
          credits: user.credits,
          stripePaymentIntentId: `migration_${userId}_${Date.now()}`,
          status: "completed",
        },
      });

      // Then create the ledger entry
      await tx.ledgerEntry.create({
        data: {
          userId,
          type: "credit",
          credits: user.credits,
          description: `Migrated ${user.credits} credits from legacy User.credits field`,
          idempotencyKey: `migration:user-credits:${userId}`,
          purchaseId: purchase.id,
        },
      });

      console.log(`✅ Created ledger entry for ${user.credits} credits`);
    });

    // Verify the balance
    const balanceAgg = await prisma.ledgerEntry.aggregate({
      _sum: { credits: true },
      where: { userId },
    });

    const balance = Number(balanceAgg._sum.credits ?? 0);
    console.log(`✅ New balance: ${balance} credits`);

  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration for the specified user
const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/migrate-user-credits.ts <userId>");
  process.exit(1);
}

migrateUserCredits(userId);


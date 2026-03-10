const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function grantCredits() {
  try {
    // Update via User.credits (fallback system)
    const result = await prisma.user.updateMany({
      where: {
        email: {
          in: ['bennieking5@gmail.com', 'divaesquire57@gmail.com']
        }
      },
      data: {
        credits: { increment: 25 }
      }
    });
    
    console.log(`✅ Granted 25 credits to ${result.count} admin users`);
    
    // Also create ledger entries for proper tracking
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: ['bennieking5@gmail.com', 'divaesquire57@gmail.com']
        }
      }
    });
    
    for (const user of users) {
      try {
        await prisma.ledgerEntry.create({
          data: {
            userId: user.id,
            type: 'credit',
            credits: 25,
            description: 'Manual credit grant for testing',
            idempotencyKey: `manual-grant-${Date.now()}-${user.id}`
          }
        });
        console.log(`✅ Created ledger entry for ${user.email}`);
      } catch (ledgerError) {
        console.log(`⚠️ Could not create ledger entry (table may not exist): ${ledgerError.message}`);
      }
    }
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

grantCredits();


















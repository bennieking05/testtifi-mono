const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addCredits() {
  try {
    // Add 10 credits from test purchase
    const result = await prisma.user.update({
      where: { id: '224adc38-fd8b-4d5f-91af-7995b5413b94' },
      data: { credits: { increment: 10 } }
    });
    
    console.log(`✅ Added 10 credits. New balance: ${result.credits}`);
    
    // Create ledger entry
    try {
      await prisma.ledgerEntry.create({
        data: {
          userId: '224adc38-fd8b-4d5f-91af-7995b5413b94',
          type: 'credit',
          credits: 10,
          description: 'Test payment pi_3SGh0xP0QEFCJzDA1nXDeWCM',
          idempotencyKey: `pi:pi_3SGh0xP0QEFCJzDA1nXDeWCM`
        }
      });
      console.log('✅ Ledger entry created');
    } catch (e) {
      console.log('⚠️ Ledger entry failed (table may not exist)');
    }
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

addCredits();


















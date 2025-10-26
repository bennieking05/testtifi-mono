const { PrismaClient } = require('@prisma/client');

console.log('Testing worker main loop...');

const prisma = new PrismaClient();

async function testWork() {
  try {
    console.log('Testing database connection...');
    await prisma.$connect();
    console.log('Database connected');
    
    console.log('Testing job query...');
    const candidate = await prisma.summaryJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    
    console.log('Found candidate job:', candidate);
    
    await prisma.$disconnect();
    console.log('Test completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

testWork();




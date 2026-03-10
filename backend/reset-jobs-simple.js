const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetJobs() {
  try {
    const result = await prisma.summaryJob.updateMany({
      where: { 
        status: 'processing',
        id: { in: ['a98dffa1-d1dc-4cd3-ad03-fc63e887f3f0', 'e0c176c8-69c9-47fa-a898-76a56974062b'] }
      },
      data: { status: 'queued' }
    });
    console.log('Reset jobs:', result.count);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

resetJobs();

















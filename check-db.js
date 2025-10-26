const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkJobs() {
  try {
    const jobs = await prisma.summaryJob.findMany({
      where: { status: 'complete' },
      select: {
        id: true,
        fileName: true,
        lastPageProcessed: true,
        totalPages: true,
        file: { select: { pages: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    
    console.log('Recent completed jobs:');
    jobs.forEach(job => {
      console.log(JSON.stringify(job, null, 2));
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkJobs();




// Script to find and reset all stuck processing jobs
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetStuckJobs() {
  try {
    // First, find all jobs stuck in processing status
    const stuckJobs = await prisma.summaryJob.findMany({
      where: { 
        status: 'processing'
      },
      select: {
        id: true,
        fileName: true,
        status: true,
        lastPageProcessed: true,
        totalPages: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log(`\n🔍 Found ${stuckJobs.length} stuck job(s) in processing status:\n`);
    
    stuckJobs.forEach(job => {
      const ageMinutes = Math.floor((Date.now() - new Date(job.updatedAt).getTime()) / 60000);
      console.log(`  - ${job.fileName}`);
      console.log(`    ID: ${job.id}`);
      console.log(`    Pages: ${job.lastPageProcessed}/${job.totalPages}`);
      console.log(`    Stuck for: ${ageMinutes} minutes`);
      console.log(`    Created: ${job.createdAt}`);
      console.log('');
    });
    
    if (stuckJobs.length === 0) {
      console.log('✅ No stuck jobs found!');
      return;
    }
    
    // Reset all stuck jobs to queued status
    const result = await prisma.summaryJob.updateMany({
      where: { 
        status: 'processing'
      },
      data: { status: 'queued' }
    });
    
    console.log(`\n✅ Successfully reset ${result.count} stuck job(s) to queued status!\n`);
    console.log('The worker should pick them up and start processing again.\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

resetStuckJobs();


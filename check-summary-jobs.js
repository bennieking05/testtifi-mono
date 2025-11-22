const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAllJobs() {
  try {
    console.log('=== Checking all summary jobs ===\n');
    
    // Check queued jobs
    const queuedJobs = await prisma.summaryJob.findMany({
      where: { status: 'queued' },
      select: {
        id: true,
        fileName: true,
        status: true,
        lastPageProcessed: true,
        totalPages: true,
        createdAt: true,
        updatedAt: true,
        error: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log(`📋 Queued jobs (${queuedJobs.length}):`);
    queuedJobs.forEach(job => {
      console.log(`  - ${job.fileName} (${job.id})`);
      console.log(`    Status: ${job.status}, Pages: ${job.lastPageProcessed}/${job.totalPages}`);
      console.log(`    Created: ${job.createdAt}, Updated: ${job.updatedAt}`);
      if (job.error) console.log(`    Error: ${job.error.substring(0, 100)}`);
      console.log('');
    });
    
    // Check processing jobs
    const processingJobs = await prisma.summaryJob.findMany({
      where: { status: 'processing' },
      select: {
        id: true,
        fileName: true,
        status: true,
        lastPageProcessed: true,
        totalPages: true,
        createdAt: true,
        updatedAt: true,
        error: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log(`⚙️  Processing jobs (${processingJobs.length}):`);
    processingJobs.forEach(job => {
      const ageMinutes = Math.floor((Date.now() - new Date(job.updatedAt).getTime()) / 60000);
      console.log(`  - ${job.fileName} (${job.id})`);
      console.log(`    Status: ${job.status}, Pages: ${job.lastPageProcessed}/${job.totalPages}`);
      console.log(`    Created: ${job.createdAt}, Updated: ${job.updatedAt} (${ageMinutes} min ago)`);
      if (job.error) console.log(`    Error: ${job.error.substring(0, 100)}`);
      console.log('');
    });
    
    // Check for UAT 15 specifically
    const uat15Jobs = await prisma.summaryJob.findMany({
      where: {
        OR: [
          { fileName: { contains: 'UAT 15' } },
          { fileName: { contains: 'UAT15' } },
          { fileName: { contains: 'uat 15' } },
          { fileName: { contains: 'uat15' } },
        ]
      },
      select: {
        id: true,
        fileName: true,
        status: true,
        lastPageProcessed: true,
        totalPages: true,
        createdAt: true,
        updatedAt: true,
        error: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log(`\n🎯 UAT 15 related jobs (${uat15Jobs.length}):`);
    uat15Jobs.forEach(job => {
      const ageMinutes = Math.floor((Date.now() - new Date(job.updatedAt).getTime()) / 60000);
      console.log(`  - ${job.fileName} (${job.id})`);
      console.log(`    Status: ${job.status}, Pages: ${job.lastPageProcessed}/${job.totalPages}`);
      console.log(`    Created: ${job.createdAt}, Updated: ${job.updatedAt} (${ageMinutes} min ago)`);
      if (job.error) console.log(`    Error: ${job.error.substring(0, 200)}`);
      console.log('');
    });
    
    // Recent jobs (all statuses)
    const recentJobs = await prisma.summaryJob.findMany({
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
      take: 10,
    });
    
    console.log(`\n📊 Recent jobs (last 10):`);
    recentJobs.forEach(job => {
      const ageMinutes = Math.floor((Date.now() - new Date(job.updatedAt).getTime()) / 60000);
      console.log(`  - ${job.fileName.substring(0, 50)}`);
      console.log(`    Status: ${job.status}, Pages: ${job.lastPageProcessed}/${job.totalPages}, Updated: ${ageMinutes} min ago`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllJobs();





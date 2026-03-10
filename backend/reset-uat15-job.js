const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetUAT15Job() {
  try {
    const jobId = 'db9c2beb-653d-4801-b46e-15e66ce9bcdb';
    
    // First, check current status
    const job = await prisma.summaryJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        fileName: true,
        status: true,
        lastPageProcessed: true,
        totalPages: true,
        error: true,
      }
    });
    
    if (!job) {
      console.log('Job not found');
      return;
    }
    
    console.log('Current job status:');
    console.log(JSON.stringify(job, null, 2));
    
    // Reset to queued so worker can retry
    const result = await prisma.summaryJob.update({
      where: { id: jobId },
      data: {
        status: 'queued',
        error: null, // Clear any errors
      }
    });
    
    console.log('\n✅ Job reset to queued status');
    console.log('The worker should pick it up and retry processing.');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetUAT15Job();





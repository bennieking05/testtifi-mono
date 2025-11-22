const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkJobDetails() {
  try {
    const jobId = 'db9c2beb-653d-4801-b46e-15e66ce9bcdb';
    
    const job = await prisma.summaryJob.findUnique({
      where: { id: jobId },
      include: {
        user: {
          select: {
            email: true,
            name: true,
          }
        },
        file: true,
      }
    });
    
    if (!job) {
      console.log('Job not found');
      return;
    }
    
    console.log('=== Job Details ===');
    console.log(`ID: ${job.id}`);
    console.log(`File Name: ${job.fileName}`);
    console.log(`Status: ${job.status}`);
    console.log(`Pages: ${job.lastPageProcessed}/${job.totalPages}`);
    console.log(`Created: ${job.createdAt}`);
    console.log(`Updated: ${job.updatedAt}`);
    console.log(`Started: ${job.startedAt}`);
    console.log(`Finished: ${job.finishedAt || 'Not finished'}`);
    console.log(`Error: ${job.error || 'None'}`);
    console.log(`File URL: ${job.fileUrl}`);
    console.log(`Summary CSV URL: ${job.summaryCsvUrl || 'Not generated'}`);
    console.log(`User: ${job.user?.name || job.user?.email || 'Unknown'}`);
    console.log(`Notify on Complete: ${job.notifyOnComplete}`);
    
    if (job.file) {
      console.log(`\nFile Details:`);
      console.log(`  File ID: ${job.file.id}`);
      console.log(`  Title: ${job.file.title}`);
      console.log(`  Pages: ${job.file.pages}`);
      console.log(`  Deponent: ${job.file.deponent}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkJobDetails();





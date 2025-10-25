const { Storage } = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');

console.log('Testing Google Cloud clients...');

try {
  const storage = new Storage();
  console.log('Storage client created successfully');
  
  const visionClient = new vision.ImageAnnotatorClient();
  console.log('Vision client created successfully');
  
  console.log('All Google Cloud clients initialized successfully');
  process.exit(0);
} catch (err) {
  console.error('Google Cloud client initialization failed:', err);
  process.exit(1);
}



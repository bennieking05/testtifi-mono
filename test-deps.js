console.log('Testing worker dependencies...');

try {
  const pLimit = require('p-limit');
  console.log('p-limit imported successfully');
  
  const os = require('os');
  console.log('os imported successfully');
  console.log('Hostname:', os.hostname());
  
  const fs = require('fs');
  console.log('fs imported successfully');
  
  const path = require('path');
  console.log('path imported successfully');
  
  const pdf = require('pdf-parse');
  console.log('pdf-parse imported successfully');
  
  const mammoth = require('mammoth');
  console.log('mammoth imported successfully');
  
  console.log('All dependencies imported successfully');
  process.exit(0);
} catch (err) {
  console.error('Dependency import failed:', err);
  process.exit(1);
}




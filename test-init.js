console.log('Testing worker initialization...');

// Test environment variables
console.log('DETAIL_MODE:', process.env.SUMMARY_DETAIL_MODE || 'high');
console.log('PAGE_RANGE_SIZE:', process.env.PAGE_RANGE_SIZE || '5');
console.log('AZURE_MAX_TOKENS:', process.env.AZURE_MAX_TOKENS || '4000');
console.log('WORKER_CONCURRENCY:', process.env.WORKER_CONCURRENCY || '1');

// Test pLimit initialization
try {
  const pLimit = require('p-limit');
  const limit = pLimit(1);
  console.log('pLimit initialized successfully');
} catch (err) {
  console.error('pLimit initialization failed:', err);
  process.exit(1);
}

// Test os.hostname()
try {
  const os = require('os');
  const hostname = os.hostname();
  console.log('Hostname:', hostname);
} catch (err) {
  console.error('os.hostname() failed:', err);
  process.exit(1);
}

console.log('All initialization tests passed');
process.exit(0);




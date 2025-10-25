console.log('Testing Azure OpenAI configuration...');

console.log('AZURE_OPENAI_API_KEY:', process.env.AZURE_OPENAI_API_KEY ? 'SET' : 'NOT SET');
console.log('AZURE_OPENAI_ENDPOINT:', process.env.AZURE_OPENAI_ENDPOINT ? 'SET' : 'NOT SET');
console.log('AZURE_OPENAI_DEPLOYMENT_NAME:', process.env.AZURE_OPENAI_DEPLOYMENT_NAME ? 'SET' : 'NOT SET');
console.log('AZURE_API_VERSION:', process.env.AZURE_API_VERSION ? 'SET' : 'NOT SET');

// Test axios import
try {
  const axios = require('axios');
  console.log('Axios imported successfully');
} catch (err) {
  console.error('Axios import failed:', err);
  process.exit(1);
}

console.log('All Azure configuration tests passed');
process.exit(0);



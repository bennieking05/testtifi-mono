const { loadPromptConfig } = require('./dist/lib/promptConfig');

console.log('Testing prompt config loading...');

try {
  const config = loadPromptConfig();
  console.log('Prompt config loaded successfully');
  console.log('System prompt length:', config.system.length);
  console.log('Temperature:', config.temperature);
  console.log('Max tokens:', config.maxTokens);
  process.exit(0);
} catch (err) {
  console.error('Prompt config loading failed:', err);
  process.exit(1);
}



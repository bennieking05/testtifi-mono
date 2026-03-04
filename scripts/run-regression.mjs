#!/usr/bin/env node

/**
 * Master Regression Test Runner for TestifiAI
 * 
 * Orchestrates both API and Frontend tests, then generates a summary report.
 * 
 * Usage:
 *   node scripts/run-regression.mjs [target]
 *   
 *   target: 'local' (default), 'staging', or 'prod'
 * 
 * Example:
 *   node scripts/run-regression.mjs local
 *   npm run test:regression
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TARGET = (process.argv[2] || 'local').toLowerCase();
const RESULTS_DIR = path.join(ROOT, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

// Backend URLs for API tests (must match scripts/api-regression.mjs)
const BACKEND_URLS = {
  local: 'http://localhost:4000',
  staging: 'https://testifi-backend-staging-748916208557.us-central1.run.app',
  prod: 'https://testifi-backend-748916208557.us-central1.run.app',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n📦 Running: ${command} ${args.join(' ')}\n`);
    
    const proc = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      ...options,
    });

    proc.on('close', (code) => {
      resolve(code);
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function parseCSVFile(filepath) {
  if (!fs.existsSync(filepath)) {
    return [];
  }
  
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n');
  
  if (lines.length < 2) {
    return [];
  }
  
  const headers = lines[0].split(',');
  const results = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').replace(/^"|"$/g, '').trim();
    });
    results.push(row);
  }
  
  return results;
}

function findLatestCSV(dir, prefix) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.csv'))
    .sort()
    .reverse();
  
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Report Generation
// ─────────────────────────────────────────────────────────────────────────────

function generateSummaryReport(apiResults, frontendPassed, frontendFailed) {
  const summaryPath = path.join(RESULTS_DIR, `regression-summary-${timestamp}.csv`);
  
  // Count API results
  const apiPassed = apiResults.filter(r => r.passed === 'true').length;
  const apiFailed = apiResults.length - apiPassed;
  
  const totalPassed = apiPassed + frontendPassed;
  const totalFailed = apiFailed + frontendFailed;
  const totalTests = totalPassed + totalFailed;
  const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0.0';
  
  // Write summary CSV
  const header = 'timestamp,target,total_tests,passed,failed,pass_rate,api_passed,api_failed,frontend_passed,frontend_failed';
  const row = `${new Date().toISOString()},${TARGET},${totalTests},${totalPassed},${totalFailed},${passRate}%,${apiPassed},${apiFailed},${frontendPassed},${frontendFailed}`;
  
  fs.writeFileSync(summaryPath, `${header}\n${row}`);
  
  return {
    summaryPath,
    totalTests,
    totalPassed,
    totalFailed,
    passRate,
    apiPassed,
    apiFailed,
    frontendPassed,
    frontendFailed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Runner
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       TestifiAI Master Regression Test Runner                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n🎯 Target: ${TARGET}`);
  console.log(`📅 Started: ${new Date().toISOString()}`);
  console.log(`📁 Results: ${RESULTS_DIR}\n`);
  
  ensureDir(RESULTS_DIR);
  
  let apiResults = [];
  let frontendPassed = 0;
  let frontendFailed = 0;
  let apiExitCode = 0;
  let frontendExitCode = 0;
  
  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1: API Tests
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log('\n' + '═'.repeat(68));
  console.log('  PHASE 1: API Endpoint Tests');
  console.log('═'.repeat(68));
  console.log(`\n🔗 Backend URL: ${BACKEND_URLS[TARGET] || BACKEND_URLS.local}`);
  
  try {
    apiExitCode = await runCommand('node', ['scripts/api-regression.mjs', TARGET]);
    
    // Find and parse the latest API results
    const apiCSV = findLatestCSV(RESULTS_DIR, 'api-results-');
    if (apiCSV) {
      apiResults = parseCSVFile(apiCSV);
      console.log(`\n📊 API Results: ${apiResults.length} tests`);
    }
  } catch (err) {
    console.error('❌ API tests failed:', err.message);
    apiExitCode = 1;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2: Frontend Tests
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log('\n' + '═'.repeat(68));
  console.log('  PHASE 2: Frontend E2E Tests');
  console.log('═'.repeat(68));
  
  // Frontend URLs for Playwright tests
  const FRONTEND_URLS = {
    local: 'http://localhost:5173',
    staging: 'https://staging.app.testifi.ai',
    prod: 'https://app.testifi.ai',
  };
  const frontendBaseUrl = FRONTEND_URLS[TARGET] || FRONTEND_URLS.local;
  
  console.log(`\n🌐 Frontend Base URL: ${frontendBaseUrl}`);
  
  try {
    // Run Playwright tests with JSON reporter to capture results
    const playwrightArgs = [
      'playwright',
      'test',
      'tests/regression/',
      '--reporter=list,json',
      `--output=${path.join(RESULTS_DIR, 'playwright-results')}`,
    ];
    
    frontendExitCode = await runCommand('npx', playwrightArgs, {
      env: {
        ...process.env,
        BASE_URL: frontendBaseUrl,  // Used by playwright.config.ts
      },
    });
    
    // Try to parse Playwright JSON results
    const playwrightJsonPath = path.join(RESULTS_DIR, 'playwright-results', 'results.json');
    if (fs.existsSync(playwrightJsonPath)) {
      try {
        const playwrightResults = JSON.parse(fs.readFileSync(playwrightJsonPath, 'utf8'));
        // Count passed/failed from Playwright results
        if (playwrightResults.suites) {
          const countTests = (suites) => {
            let passed = 0;
            let failed = 0;
            for (const suite of suites) {
              if (suite.specs) {
                for (const spec of suite.specs) {
                  if (spec.ok) {
                    passed++;
                  } else {
                    failed++;
                  }
                }
              }
              if (suite.suites) {
                const nested = countTests(suite.suites);
                passed += nested.passed;
                failed += nested.failed;
              }
            }
            return { passed, failed };
          };
          const counts = countTests(playwrightResults.suites);
          frontendPassed = counts.passed;
          frontendFailed = counts.failed;
        }
      } catch {
        // Could not parse JSON results
      }
    }
    
    // Fallback: estimate from exit code
    if (frontendPassed === 0 && frontendFailed === 0) {
      if (frontendExitCode === 0) {
        frontendPassed = 1; // At least 1 passed
      } else {
        frontendFailed = 1; // At least 1 failed
      }
    }
    
    console.log(`\n📊 Frontend Results: ${frontendPassed} passed, ${frontendFailed} failed`);
  } catch (err) {
    console.error('❌ Frontend tests failed:', err.message);
    frontendExitCode = 1;
    frontendFailed = 1;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3: Generate Summary Report
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log('\n' + '═'.repeat(68));
  console.log('  PHASE 3: Summary Report');
  console.log('═'.repeat(68));
  
  const summary = generateSummaryReport(apiResults, frontendPassed, frontendFailed);
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    REGRESSION TEST SUMMARY                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`
  📊 Overall Results
  ──────────────────────────────────────────────────
  Total Tests:     ${summary.totalTests}
  ✅ Passed:       ${summary.totalPassed}
  ❌ Failed:       ${summary.totalFailed}
  Pass Rate:       ${summary.passRate}%
  
  📡 API Tests
  ──────────────────────────────────────────────────
  Passed:          ${summary.apiPassed}
  Failed:          ${summary.apiFailed}
  
  🖥️  Frontend Tests
  ──────────────────────────────────────────────────
  Passed:          ${summary.frontendPassed}
  Failed:          ${summary.frontendFailed}
  
  📁 Output Files
  ──────────────────────────────────────────────────
  Summary:         ${summary.summaryPath}
  Screenshots:     ${path.join(RESULTS_DIR, 'screenshots/')}
`);
  
  // Exit with failure if any tests failed
  const overallExitCode = (apiExitCode !== 0 || frontendExitCode !== 0) ? 1 : 0;
  
  if (overallExitCode === 0) {
    console.log('✅ All regression tests passed!\n');
  } else {
    console.log('❌ Some regression tests failed. See details above.\n');
  }
  
  process.exit(overallExitCode);
}

main().catch((err) => {
  console.error('❌ Test runner error:', err);
  process.exit(1);
});


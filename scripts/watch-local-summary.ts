#!/usr/bin/env npx ts-node
/**
 * watch-local-summary.ts
 *
 * Tails Docker Compose summarize-worker logs, parses summary output,
 * and validates format requirements:
 *   - 100% page coverage (no gaps)
 *   - Max 5 pages per row (topic grouping)
 *   - Line numbers only when detected from OCR
 *
 * Usage:
 *   npx ts-node scripts/watch-local-summary.ts [--container <name>] [--once]
 *
 * Options:
 *   --container <name>  Container name (default: auto-detect summarize-worker)
 *   --once              Exit after first summary is validated
 *   --help              Show this help
 */

import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import {
  parseSummaryRows,
  validateCoverage,
  validateGrouping,
  validateLineNumbers,
  ValidationResult,
} from "./summary-validators";

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let containerName = "";
let exitOnFirst = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--container" && args[i + 1]) {
    containerName = args[++i];
  } else if (args[i] === "--once") {
    exitOnFirst = true;
  } else if (args[i] === "--help") {
    console.log(`
Usage: npx ts-node scripts/watch-local-summary.ts [options]

Options:
  --container <name>  Specify container name (default: auto-detect)
  --once              Exit after validating first summary
  --help              Show this help
`);
    process.exit(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary block detection state machine
// ─────────────────────────────────────────────────────────────────────────────
interface SummaryBlock {
  jobId: string;
  deponent: string;
  totalPages: number;
  rows: string[];
  warnings: string[];
}

let currentBlock: SummaryBlock | null = null;
let inSummaryBlock = false;
let inWarningsBlock = false;
let summaryCount = 0;

// Patterns for detecting summary boundaries
const SUMMARY_START = /Transcript Summary of\s+(.+)/i;
const PAGES_LINE = /Pages:\s*(\d+)/i;
const WARNINGS_START = /VALIDATION WARNINGS/i;
const SEPARATOR_LINE = /^=+$/;
const PAGE_ROW = /^\s*\|?\s*(p\.\d+(?:-\d+)?(?::\d+(?:-\d+)?)?)\s*\|?\s*(.+)/i;
const JOB_ID = /\[([a-f0-9-]{36})\]/i;

function resetBlock() {
  currentBlock = null;
  inSummaryBlock = false;
  inWarningsBlock = false;
}

function processLine(line: string) {
  // Try to extract job ID from any line
  const jobMatch = line.match(JOB_ID);

  // Check for summary start
  const startMatch = line.match(SUMMARY_START);
  if (startMatch) {
    resetBlock();
    currentBlock = {
      jobId: jobMatch?.[1] || "unknown",
      deponent: startMatch[1].trim(),
      totalPages: 0,
      rows: [],
      warnings: [],
    };
    inSummaryBlock = true;
    console.log(`\n📄 Detected summary for: ${currentBlock.deponent}`);
    return;
  }

  if (!currentBlock) return;

  // Extract page count
  const pagesMatch = line.match(PAGES_LINE);
  if (pagesMatch) {
    currentBlock.totalPages = parseInt(pagesMatch[1], 10);
    console.log(`   Pages: ${currentBlock.totalPages}`);
    return;
  }

  // Check for warnings section
  if (WARNINGS_START.test(line)) {
    inWarningsBlock = true;
    return;
  }

  // Collect warnings
  if (inWarningsBlock && line.startsWith("•")) {
    currentBlock.warnings.push(line.replace(/^•\s*/, ""));
    return;
  }

  // Check for separator (end of header, start of content)
  if (SEPARATOR_LINE.test(line.trim())) {
    inWarningsBlock = false;
    return;
  }

  // Collect page rows
  const rowMatch = line.match(PAGE_ROW);
  if (rowMatch && inSummaryBlock) {
    currentBlock.rows.push(line);
    return;
  }

  // Detect end of summary (empty line after rows, or new job starting)
  if (
    inSummaryBlock &&
    currentBlock.rows.length > 0 &&
    (line.trim() === "" || line.includes("[WORKER]"))
  ) {
    finalizeSummary();
  }
}

function finalizeSummary() {
  if (!currentBlock || currentBlock.rows.length === 0) {
    resetBlock();
    return;
  }

  summaryCount++;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📊 SUMMARY #${summaryCount} VALIDATION`);
  console.log(`${"─".repeat(60)}`);
  console.log(`Job ID: ${currentBlock.jobId}`);
  console.log(`Deponent: ${currentBlock.deponent}`);
  console.log(`Total Pages: ${currentBlock.totalPages}`);
  console.log(`Rows Parsed: ${currentBlock.rows.length}`);

  // Parse rows
  const parsed = parseSummaryRows(currentBlock.rows);
  console.log(`\nParsed ${parsed.length} page entries`);

  // Run validations
  const results: ValidationResult[] = [];

  if (currentBlock.totalPages > 0) {
    results.push(validateCoverage(parsed, currentBlock.totalPages));
    results.push(validateGrouping(parsed));
    results.push(validateLineNumbers(parsed));
  } else {
    console.log("⚠️  Could not determine total pages - skipping validation");
  }

  // Print results
  let allPassed = true;
  for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`\n${icon} ${result.name}`);
    if (result.details) {
      console.log(`   ${result.details}`);
    }
    if (!result.passed) {
      allPassed = false;
      if (result.issues.length > 0) {
        console.log("   Issues:");
        result.issues.slice(0, 5).forEach((issue) => {
          console.log(`     • ${issue}`);
        });
        if (result.issues.length > 5) {
          console.log(`     ... and ${result.issues.length - 5} more`);
        }
      }
    }
  }

  // Print existing warnings from worker
  if (currentBlock.warnings.length > 0) {
    console.log("\n⚠️  Worker Warnings:");
    currentBlock.warnings.forEach((w) => console.log(`   • ${w}`));
  }

  // Final verdict
  console.log(`\n${"─".repeat(60)}`);
  if (allPassed) {
    console.log("🎉 FORMAT OK - All validations passed!");
  } else {
    console.log("❗ FORMAT ISSUES - See above for details");
  }
  console.log(`${"─".repeat(60)}\n`);

  resetBlock();

  if (exitOnFirst) {
    console.log("Exiting after first summary (--once flag)");
    process.exit(allPassed ? 0 : 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker log tailing
// ─────────────────────────────────────────────────────────────────────────────
async function findWorkerContainer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn("docker", ["compose", "ps", "--format", "{{.Name}}"]);
    let output = "";
    ps.stdout.on("data", (data) => (output += data.toString()));
    ps.stderr.on("data", (data) => console.error(data.toString()));
    ps.on("close", (code) => {
      if (code !== 0) {
        // Try docker-compose (older syntax)
        const ps2 = spawn("docker-compose", ["ps", "--format", "{{.Name}}"]);
        let output2 = "";
        ps2.stdout.on("data", (data) => (output2 += data.toString()));
        ps2.on("close", (code2) => {
          if (code2 !== 0) {
            reject(new Error("Failed to list Docker containers"));
            return;
          }
          const containers = output2.trim().split("\n").filter(Boolean);
          const worker = containers.find(
            (c) => c.includes("worker") || c.includes("backend")
          );
          resolve(worker || containers[0] || "");
        });
        return;
      }
      const containers = output.trim().split("\n").filter(Boolean);
      const worker = containers.find(
        (c) => c.includes("worker") || c.includes("backend")
      );
      resolve(worker || containers[0] || "");
    });
  });
}

async function tailLogs(container: string): Promise<ChildProcess> {
  console.log(`🔍 Tailing logs for container: ${container}`);
  console.log("Waiting for summary output...\n");

  const tail = spawn("docker", ["logs", "-f", container], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rl = readline.createInterface({ input: tail.stdout });
  rl.on("line", processLine);

  tail.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes("Attaching")) {
      console.error(`[stderr] ${msg}`);
    }
  });

  tail.on("close", (code) => {
    console.log(`\nLog tail ended (code ${code})`);
    // Finalize any pending summary
    if (currentBlock && currentBlock.rows.length > 0) {
      finalizeSummary();
    }
  });

  return tail;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 TestifiAI Local Summary Watcher");
  console.log("==================================\n");

  let container = containerName;
  if (!container) {
    try {
      container = await findWorkerContainer();
      if (!container) {
        console.error(
          "❌ No Docker containers found. Start containers with:"
        );
        console.error("   docker compose up -d");
        process.exit(1);
      }
    } catch (err) {
      console.error("❌ Failed to find containers:", err);
      process.exit(1);
    }
  }

  const tail = await tailLogs(container);

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    console.log("\n\nShutting down...");
    tail.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

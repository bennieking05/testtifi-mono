// src/worker/judges/runAllJudges.ts
// Orchestrates parallel execution of all judge agents

import { JudgeResult, JudgeContext } from "./types";
import { pageCountJudge } from "./pageCountJudge";
import { metadataJudge } from "./metadataJudge";
import { summaryJudge } from "./summaryJudge";
import { lineNumberJudge } from "./lineNumberJudge";

export interface JudgeResults {
  allPassed: boolean;
  results: JudgeResult[];
  totalWarnings: number;
  totalInstructions: number;
}

/**
 * Run all judge agents in parallel and aggregate results.
 */
export async function runAllJudges(context: JudgeContext): Promise<JudgeResults> {
  const { jobId } = context;

  console.log(`[${jobId}] Running judge agents...`);

  // Run all judges in parallel
  const results = await Promise.all([
    Promise.resolve(pageCountJudge(context)),
    Promise.resolve(metadataJudge(context)),
    Promise.resolve(summaryJudge(context)),
    Promise.resolve(lineNumberJudge(context)),
  ]);

  // Aggregate results
  const allPassed = results.every((r) => r.passed);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
  const totalInstructions = results.reduce((sum, r) => sum + r.instructions.length, 0);

  // Log summary
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `[${jobId}] ${result.judgeName}: ${status} (${result.warnings.length} warnings)`
    );

    for (const warning of result.warnings) {
      console.warn(`[${jobId}] ${result.judgeName} WARNING: ${warning}`);
    }
  }

  console.log(
    `[${jobId}] Judge results: ${allPassed ? "ALL PASSED" : "SOME FAILED"} ` +
      `(${totalWarnings} warnings, ${totalInstructions} instructions)`
  );

  return {
    allPassed,
    results,
    totalWarnings,
    totalInstructions,
  };
}

/**
 * Format judge results for storage in metadata.
 */
export function formatJudgeResultsForStorage(judgeResults: JudgeResults): {
  allPassed: boolean;
  judges: Array<{
    name: string;
    passed: boolean;
    warnings: string[];
    instructions: string[];
  }>;
} {
  return {
    allPassed: judgeResults.allPassed,
    judges: judgeResults.results.map((r) => ({
      name: r.judgeName,
      passed: r.passed,
      warnings: r.warnings,
      instructions: r.instructions,
    })),
  };
}

/**
 * Format judge warnings for display on cover pages.
 */
export function formatWarningsForDisplay(judgeResults: JudgeResults): string[] {
  const displayWarnings: string[] = [];

  for (const result of judgeResults.results) {
    if (!result.passed || result.warnings.length > 0) {
      for (const warning of result.warnings) {
        displayWarnings.push(`[${result.judgeName}] ${warning}`);
      }
    }
  }

  return displayWarnings;
}

/**
 * Format instructions for admin notification.
 */
export function formatInstructionsForAdmin(judgeResults: JudgeResults): string {
  const lines: string[] = [];

  lines.push("## Summary Validation Report");
  lines.push("");
  lines.push(`Overall Status: ${judgeResults.allPassed ? "PASSED" : "NEEDS REVIEW"}`);
  lines.push("");

  for (const result of judgeResults.results) {
    lines.push(`### ${result.judgeName}: ${result.passed ? "PASS" : "FAIL"}`);

    if (result.warnings.length > 0) {
      lines.push("");
      lines.push("**Warnings:**");
      for (const warning of result.warnings) {
        lines.push(`- ${warning}`);
      }
    }

    if (result.instructions.length > 0) {
      lines.push("");
      lines.push("**Review Instructions:**");
      for (const instruction of result.instructions) {
        lines.push(`- ${instruction}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export { JudgeResult, JudgeContext };





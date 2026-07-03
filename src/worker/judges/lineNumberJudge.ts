// src/worker/judges/lineNumberJudge.ts
// Validates line number presence/format in summary output

import { JudgeResult, JudgeContext } from "./types";

const PLACEHOLDER_TAG = "[LLM did not summarize";
const MAX_LINE_NUM = 35;
const MIN_LINE_COVERAGE = Number(process.env.JUDGE_MIN_LINE_COVERAGE) || 0.7;

export function lineNumberJudge(context: JudgeContext): JudgeResult {
  const { summaryRows } = context;

  const warnings: string[] = [];
  const instructions: string[] = [];
  let passed = true;

  if (!summaryRows || summaryRows.length === 0) {
    return {
      judgeName: "LineNumberJudge",
      passed: true,
      warnings,
      instructions,
    };
  }

  let totalEligible = 0;
  let withLineNumbers = 0;
  const invalidLineNumbers: string[] = [];

  for (const row of summaryRows) {
    const isPlaceholder = row.summary.includes(PLACEHOLDER_TAG);
    if (isPlaceholder) continue;

    totalEligible += 1;

    const lineRangeMatch = row.pageLabel.match(/:(\d{1,2})\s*[-–]\s*(\d{1,2})/);
    if (lineRangeMatch) {
      withLineNumbers += 1;
      const start = parseInt(lineRangeMatch[1], 10);
      const end = parseInt(lineRangeMatch[2], 10);
      if (start > end || end > MAX_LINE_NUM) {
        invalidLineNumbers.push(row.pageLabel);
      }
    }
  }

  if (invalidLineNumbers.length > 0) {
    warnings.push(
      `Found invalid line ranges in ${invalidLineNumbers.length} row(s). Examples: ${invalidLineNumbers
        .slice(0, 3)
        .join(", ")}`
    );
    instructions.push(
      "Line ranges should be in the format :Y-Z with Y<=Z and Z<=25."
    );
  }

  if (totalEligible > 0) {
    const coverage = withLineNumbers / totalEligible;
    if (coverage < MIN_LINE_COVERAGE) {
      warnings.push(
        `Only ${(coverage * 100).toFixed(0)}% of non-placeholder rows include line numbers (${withLineNumbers}/${totalEligible}).`
      );
      instructions.push(
        "Detect line numbers from transcript text when visible. Omit line numbers only when they cannot be detected."
      );
    }
  }

  return {
    judgeName: "LineNumberJudge",
    passed,
    warnings,
    instructions,
  };
}

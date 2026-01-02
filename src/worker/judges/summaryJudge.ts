// src/worker/judges/summaryJudge.ts
// Validates summary quality

import { JudgeResult, JudgeContext } from "./types";

// Configurable thresholds
const MAX_GAP_PAGES = Number(process.env.JUDGE_MAX_GAP_PAGES) || 10;
const MIN_COVERAGE_PERCENT = Number(process.env.JUDGE_MIN_COVERAGE) || 70;
const MAX_HALLUCINATION_RATIO = Number(process.env.JUDGE_MAX_HALLUCINATION) || 0.05;

/**
 * Summary Judge
 * Validates summary quality, coverage, and accuracy.
 *
 * Failure criteria:
 * - Rows with page numbers outside 1..totalPages
 * - Large gaps in coverage (missing chunks of pages)
 * - Hallucinated line numbers (e.g., line > 35)
 */
export function summaryJudge(context: JudgeContext): JudgeResult {
  const { summaryRows, totalPages } = context;

  const warnings: string[] = [];
  const instructions: string[] = [];
  let passed = true;

  if (!summaryRows || summaryRows.length === 0) {
    passed = false;
    warnings.push("No summary rows were generated.");
    instructions.push(
      "The summarization process failed to produce any output. " +
        "Check the transcript quality and retry the job."
    );
    return {
      judgeName: "SummaryJudge",
      passed,
      warnings,
      instructions,
    };
  }

  // Extract all page numbers from rows
  const allPages: number[] = [];
  const invalidPages: number[] = [];
  const invalidLineNumbers: number[] = [];

  for (const row of summaryRows) {
    const { pageLabel } = row;

    // Extract page numbers
    const pageMatches = pageLabel.matchAll(/(?:p(?:age)?\.?\s*)?(\d{1,6})/gi);
    for (const match of pageMatches) {
      const pageNum = Number.parseInt(match[1], 10);
      if (Number.isFinite(pageNum)) {
        allPages.push(pageNum);

        if (pageNum < 1 || pageNum > totalPages) {
          invalidPages.push(pageNum);
        }
      }
    }

    // Extract and validate line numbers (format: p.X:Y or X:Y)
    const lineMatches = pageLabel.matchAll(/:\s*(\d{1,3})/g);
    for (const match of lineMatches) {
      const lineNum = Number.parseInt(match[1], 10);
      if (Number.isFinite(lineNum) && lineNum > 35) {
        invalidLineNumbers.push(lineNum);
      }
    }
  }

  // Check for invalid page numbers
  if (invalidPages.length > 0) {
    const uniqueInvalid = [...new Set(invalidPages)];
    const ratio = invalidPages.length / Math.max(1, allPages.length);

    if (ratio > MAX_HALLUCINATION_RATIO) {
      passed = false;
      warnings.push(
        `${invalidPages.length} page references are outside valid range (1-${totalPages}): ` +
          `${uniqueInvalid.slice(0, 5).join(", ")}${uniqueInvalid.length > 5 ? "..." : ""}`
      );
      instructions.push(
        "The summary contains hallucinated or incorrect page numbers. " +
          "Review and correct page references in the summary, or regenerate with corrected page count."
      );
    } else {
      warnings.push(
        `Found ${invalidPages.length} page reference(s) outside valid range (1-${totalPages}).`
      );
      instructions.push(
        "A small number of page references may be incorrect. " +
          "Review flagged entries for accuracy."
      );
    }
  }

  // Check for hallucinated line numbers
  if (invalidLineNumbers.length > 0) {
    warnings.push(
      `Found ${invalidLineNumbers.length} line number(s) > 35: ${invalidLineNumbers.slice(0, 5).join(", ")}${invalidLineNumbers.length > 5 ? "..." : ""}`
    );
    instructions.push(
      "Standard deposition transcripts have 25 lines per page. " +
        "Line numbers above 35 likely indicate errors."
    );
  }

  // Check for coverage gaps
  if (allPages.length > 0 && totalPages > 0) {
    const coveredPages = new Set(allPages.filter((p) => p >= 1 && p <= totalPages));
    const coveragePercent = (coveredPages.size / totalPages) * 100;

    if (coveragePercent < MIN_COVERAGE_PERCENT) {
      passed = false;
      warnings.push(
        `Only ${coveragePercent.toFixed(0)}% of pages (${coveredPages.size}/${totalPages}) are covered in the summary.`
      );
      instructions.push(
        "The summary has significant gaps. " +
          "Consider regenerating to ensure complete coverage, or manually summarize missing sections."
      );
    }

    // Find large gaps
    const sortedPages = [...coveredPages].sort((a, b) => a - b);
    const gaps: { start: number; end: number }[] = [];

    // Gap at beginning
    if (sortedPages[0] > 1 + MAX_GAP_PAGES) {
      gaps.push({ start: 1, end: sortedPages[0] - 1 });
    }

    // Gaps in middle
    for (let i = 0; i < sortedPages.length - 1; i++) {
      const gapSize = sortedPages[i + 1] - sortedPages[i] - 1;
      if (gapSize > MAX_GAP_PAGES) {
        gaps.push({ start: sortedPages[i] + 1, end: sortedPages[i + 1] - 1 });
      }
    }

    // Gap at end
    if (sortedPages.length > 0 && sortedPages[sortedPages.length - 1] < totalPages - MAX_GAP_PAGES) {
      gaps.push({ start: sortedPages[sortedPages.length - 1] + 1, end: totalPages });
    }

    if (gaps.length > 0) {
      const gapDescriptions = gaps.slice(0, 3).map((g) => `pages ${g.start}-${g.end}`);
      warnings.push(
        `Found ${gaps.length} large gap(s) in coverage: ${gapDescriptions.join(", ")}${gaps.length > 3 ? "..." : ""}`
      );
      instructions.push(
        "These page ranges are not covered in the summary. " +
          "Review the transcript for these sections and add summaries if needed."
      );
    }
  }

  // Check for reasonable row count
  const expectedMinRows = Math.max(1, Math.floor(totalPages / 10));
  const expectedMaxRows = totalPages * 2;

  if (summaryRows.length < expectedMinRows) {
    warnings.push(
      `Only ${summaryRows.length} summary rows for ${totalPages} pages. ` +
        `Expected at least ${expectedMinRows} rows.`
    );
    instructions.push(
      "The summary may be too sparse. Consider regenerating with more detail."
    );
  } else if (summaryRows.length > expectedMaxRows) {
    warnings.push(
      `Generated ${summaryRows.length} summary rows for ${totalPages} pages, which is unusually high.`
    );
    instructions.push(
      "The summary may contain duplicates or excessive detail. Review for redundancy."
    );
  }

  return {
    judgeName: "SummaryJudge",
    passed,
    warnings,
    instructions,
  };
}


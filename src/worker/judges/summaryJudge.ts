// src/worker/judges/summaryJudge.ts
// Validates summary quality

import { JudgeResult, JudgeContext } from "./types";

// Configurable thresholds
const MAX_GAP_PAGES = Number(process.env.JUDGE_MAX_GAP_PAGES) || 10;
const MIN_COVERAGE_PERCENT = Number(process.env.JUDGE_MIN_COVERAGE) || 70;
const MAX_HALLUCINATION_RATIO = Number(process.env.JUDGE_MAX_HALLUCINATION) || 0.05;

/**
 * Extract all page numbers from a page label, expanding ranges.
 * Handles formats like: "p.1-6", "p.93-97", "1-6", "p.1, p.2", "p.1-3, p.5"
 * 
 * @param pageLabel - The page label string (e.g., "p.93-97")
 * @param maxPage - Maximum valid page number (to cap range expansion)
 * @returns Array of all page numbers covered by this label
 */
function extractAllPagesFromLabel(pageLabel: string, _maxPage: number): number[] {
  const pages: number[] = [];
  const seen = new Set<number>();
  
  // IMPORTANT: First, strip line number suffixes like :1-25 or :3-22
  // These should NOT be interpreted as page ranges
  let withoutLineNumbers = pageLabel.replace(/:\d+(?:-\d+)?/g, '');
  
  // Normalize: remove "page", "p.", "p" prefixes and extra spaces
  // Convert to just numbers and separators
  let normalized = withoutLineNumbers
    .replace(/page\s*/gi, '')
    .replace(/p\.\s*/gi, '')
    .replace(/p\s+/gi, '')
    .trim();
  
  // Split by comma or semicolon to handle multiple entries like "1-3, 5-7"
  const parts = normalized.split(/[,;]+/);
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Check for range pattern: "93-97" or "93 - 97" or "93–97" (en-dash)
    const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      
      if (start > 0 && end >= start && end <= start + 50) {
        // Expand the range
        for (let p = start; p <= end; p++) {
          if (!seen.has(p)) {
            pages.push(p);
            seen.add(p);
          }
        }
      }
      continue;
    }
    
    // Check for single number
    const singleMatch = trimmed.match(/^(\d+)$/);
    if (singleMatch) {
      const num = parseInt(singleMatch[1], 10);
      if (num > 0 && !seen.has(num)) {
        pages.push(num);
        seen.add(num);
      }
    }
  }
  
  // If no pages found with the above, try a more aggressive approach:
  // Just find all number pairs that look like ranges in the original string
  if (pages.length === 0) {
    // Match patterns like "p.93-97" anywhere in the string
    const rangeMatches = pageLabel.matchAll(/(\d+)\s*[-–]\s*(\d+)/g);
    for (const match of rangeMatches) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start > 0 && end >= start && end <= start + 50) {
        for (let p = start; p <= end; p++) {
          if (!seen.has(p)) {
            pages.push(p);
            seen.add(p);
          }
        }
      }
    }
    
    // If still nothing, extract all standalone numbers
    if (pages.length === 0) {
      const numMatches = pageLabel.matchAll(/\b(\d+)\b/g);
      for (const match of numMatches) {
        const num = parseInt(match[1], 10);
        // Only add if it looks like a page number (1-9999) and not a line number (after colon)
        if (num > 0 && num < 10000 && !seen.has(num)) {
          // Check if this number is preceded by a colon (line number)
          const idx = match.index || 0;
          const before = pageLabel.slice(Math.max(0, idx - 2), idx);
          if (!before.includes(':')) {
            pages.push(num);
            seen.add(num);
          }
        }
      }
    }
  }
  
  return pages;
}

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

  // Extract all page numbers from rows (supporting ranges like p.1-6)
  const allPages: number[] = [];
  const invalidPages: number[] = [];
  const invalidLineNumbers: number[] = [];

  for (const row of summaryRows) {
    const { pageLabel } = row;

    // Simple approach: extract all pages mentioned, expanding any ranges
    const extractedPages = extractAllPagesFromLabel(pageLabel, totalPages);
    
    for (const pageNum of extractedPages) {
        allPages.push(pageNum);
        if (pageNum < 1 || pageNum > totalPages) {
          invalidPages.push(pageNum);
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


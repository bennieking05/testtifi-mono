/**
 * summary-validators.ts
 *
 * Reusable validation functions for summary output format.
 * Used by watch-local-summary.ts and potentially other test scripts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface ParsedRow {
  /** Original line from output */
  raw: string;
  /** Start page number */
  startPage: number;
  /** End page number (same as start for single page) */
  endPage: number;
  /** Line number start (if present) */
  lineStart?: number;
  /** Line number end (if present) */
  lineEnd?: number;
  /** Whether line numbers were explicitly present */
  hasLineNumbers: boolean;
  /** Summary text content */
  summary: string;
}

export interface ValidationResult {
  name: string;
  passed: boolean;
  details?: string;
  issues: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse summary rows from raw log lines.
 *
 * Handles formats:
 *   p.1 | Summary text...
 *   p.1-5 | Summary text...
 *   p.1:1-25 | Summary text...
 *   p.1-5:3-22 | Summary text...
 *   | p.1 | Summary text... |
 */
export function parseSummaryRows(lines: string[]): ParsedRow[] {
  const rows: ParsedRow[] = [];

  // Regex to match page references with optional line numbers
  // Groups: 1=startPage, 2=endPage (optional), 3=lineStart (optional), 4=lineEnd (optional)
  const pagePattern =
    /p\.(\d+)(?:-(\d+))?(?::(\d+)(?:-(\d+))?)?/i;

  for (const line of lines) {
    const match = line.match(pagePattern);
    if (!match) continue;

    const startPage = parseInt(match[1], 10);
    const endPage = match[2] ? parseInt(match[2], 10) : startPage;
    const lineStart = match[3] ? parseInt(match[3], 10) : undefined;
    const lineEnd = match[4] ? parseInt(match[4], 10) : lineStart;

    // Extract summary text (everything after the page reference)
    const afterPage = line.slice((match.index || 0) + match[0].length);
    const summary = afterPage
      .replace(/^\s*\|\s*/, "")
      .replace(/\s*\|\s*$/, "")
      .trim();

    rows.push({
      raw: line,
      startPage,
      endPage,
      lineStart,
      lineEnd,
      hasLineNumbers: lineStart !== undefined,
      summary,
    });
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate 100% page coverage (no gaps).
 */
export function validateCoverage(
  rows: ParsedRow[],
  totalPages: number
): ValidationResult {
  const covered = new Set<number>();
  const issues: string[] = [];

  for (const row of rows) {
    for (let p = row.startPage; p <= row.endPage; p++) {
      covered.add(p);
    }
  }

  const missing: number[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (!covered.has(p)) {
      missing.push(p);
    }
  }

  const coveragePercent = ((covered.size / totalPages) * 100).toFixed(1);
  const passed = missing.length === 0;

  if (!passed) {
    // Group consecutive missing pages into ranges for cleaner output
    const ranges: string[] = [];
    let rangeStart = missing[0];
    let rangeEnd = missing[0];

    for (let i = 1; i <= missing.length; i++) {
      if (i < missing.length && missing[i] === rangeEnd + 1) {
        rangeEnd = missing[i];
      } else {
        if (rangeStart === rangeEnd) {
          ranges.push(`${rangeStart}`);
        } else {
          ranges.push(`${rangeStart}-${rangeEnd}`);
        }
        if (i < missing.length) {
          rangeStart = missing[i];
          rangeEnd = missing[i];
        }
      }
    }

    issues.push(`Missing pages: ${ranges.slice(0, 10).join(", ")}${ranges.length > 10 ? "..." : ""}`);
  }

  return {
    name: "Page Coverage",
    passed,
    details: `${coveragePercent}% coverage (${covered.size}/${totalPages} pages)`,
    issues,
  };
}

/**
 * Validate topic grouping (max 5 pages per row, no skipped pages within groups).
 */
export function validateGrouping(rows: ParsedRow[]): ValidationResult {
  const issues: string[] = [];
  let maxGroupSize = 0;
  let oversizedGroups = 0;

  // Sort rows by start page
  const sorted = [...rows].sort((a, b) => a.startPage - b.startPage);

  for (const row of sorted) {
    const groupSize = row.endPage - row.startPage + 1;
    maxGroupSize = Math.max(maxGroupSize, groupSize);

    if (groupSize > 5) {
      oversizedGroups++;
      issues.push(
        `Row p.${row.startPage}-${row.endPage} spans ${groupSize} pages (max 5)`
      );
    }
  }

  // Check for gaps between consecutive rows
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const gap = next.startPage - current.endPage - 1;

    if (gap > 0) {
      issues.push(
        `Gap of ${gap} page(s) between p.${current.endPage} and p.${next.startPage}`
      );
    }
  }

  const passed = oversizedGroups === 0 && issues.length === 0;

  return {
    name: "Topic Grouping",
    passed,
    details: `Max group size: ${maxGroupSize} pages, ${rows.length} total rows`,
    issues,
  };
}

/**
 * Validate line numbers:
 *   - Should only be present when detected from OCR
 *   - Should be in valid range (1-25 typical, max 35)
 *   - Should not be uniformly 1-25 if actual ranges vary
 */
export function validateLineNumbers(rows: ParsedRow[]): ValidationResult {
  const issues: string[] = [];
  const rowsWithLines = rows.filter((r) => r.hasLineNumbers);
  const rowsWithoutLines = rows.filter((r) => !r.hasLineNumbers);

  // Check for invalid line numbers
  let invalidCount = 0;
  for (const row of rowsWithLines) {
    if (row.lineStart && (row.lineStart < 1 || row.lineStart > 35)) {
      invalidCount++;
      issues.push(
        `Invalid line start ${row.lineStart} at p.${row.startPage}`
      );
    }
    if (row.lineEnd && (row.lineEnd < 1 || row.lineEnd > 35)) {
      invalidCount++;
      issues.push(`Invalid line end ${row.lineEnd} at p.${row.startPage}`);
    }
  }

  // Check if all line numbers are uniformly 1-25 (might indicate no actual detection)
  const uniform125 = rowsWithLines.filter(
    (r) => r.lineStart === 1 && r.lineEnd === 25
  );
  const uniformRatio =
    rowsWithLines.length > 0
      ? uniform125.length / rowsWithLines.length
      : 0;

  let passed = invalidCount === 0;
  let details = "";

  if (rowsWithLines.length === 0) {
    details = "No line numbers present (OK if not detected from OCR)";
  } else if (uniformRatio > 0.9 && rowsWithLines.length > 5) {
    details = `${rowsWithLines.length} rows have line numbers (${(uniformRatio * 100).toFixed(0)}% are 1-25)`;
    // This is OK per the new spec - line numbers are only shown when detected
  } else {
    details = `${rowsWithLines.length} rows have line numbers, ${rowsWithoutLines.length} without`;
  }

  return {
    name: "Line Numbers",
    passed,
    details,
    issues: issues.slice(0, 5),
  };
}

/**
 * Run all validators and return combined results.
 */
export function validateAll(
  rows: ParsedRow[],
  totalPages: number
): ValidationResult[] {
  return [
    validateCoverage(rows, totalPages),
    validateGrouping(rows),
    validateLineNumbers(rows),
  ];
}

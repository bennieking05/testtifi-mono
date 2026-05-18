/**
 * Normalize page/line labels for display and assembly (Unicode dashes → ASCII hyphen).
 */
export function normalizePageLineDashes(s: string): string {
  return s.replace(/[\u2013\u2014]/g, "-");
}

const REDUNDANT_LINE_SUFFIX = /^:(\d+)-(\d+)$/;

/**
 * True when lineSuffix is like ":1-25" (typical full-page OCR range; not a precise partial cite).
 * Used when assembling markdown rows from detected line ranges.
 */
export function isRedundantLineNumberSuffix(lineSuffix: string): boolean {
  if (!lineSuffix) return false;
  const norm = normalizePageLineDashes(lineSuffix);
  const m = norm.match(REDUNDANT_LINE_SUFFIX);
  if (!m) return false;
  const ls = parseInt(m[1], 10);
  const le = parseInt(m[2], 10);
  return ls === 1 && le >= 15 && le <= 45;
}

/**
 * Remove trailing ":1-N" from a page/line cell when N looks like a redundant full-page span.
 * Improves preview/download for legacy stored markdown without reprocessing jobs.
 */
export function stripRedundantFullPageLineSuffix(pageLine: string): string {
  const s = normalizePageLineDashes(pageLine.trim());
  return s.replace(/:1-(\d+)$/g, (full, n) => {
    const le = parseInt(n, 10);
    return le >= 15 && le <= 45 ? "" : full;
  });
}

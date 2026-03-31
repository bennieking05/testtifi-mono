/**
 * Remove process/meta phrasing the model sometimes echoes into summary cells.
 */
export function sanitizeSummaryMetaLanguage(summary: string): string {
  let s = summary.trim();
  if (!s) return s;
  const leadingPatterns: RegExp[] = [
    /^(?:according to|per)\s+the\s+OCR\s+text[^.!?]*[.!?]?\s*/i,
    /^(?:according to|per)\s+the\s+(?:scanned\s+)?transcript\s+text[^.!?]*[.!?]?\s*/i,
    /^(?:the\s+)?OCR\s+text\s+(?:shows|states|indicates|reads)[^.!?]*[.!?]?\s*/i,
    /^(?:based on|from)\s+(?:the\s+)?OCR[^.!?]*[.!?]?\s*/i,
    /^[=]{2,}\s*PAGE\s+\d+\s*[=]{2,}\s*/i,
  ];
  for (const re of leadingPatterns) {
    s = s.replace(re, "").trim();
  }
  s = s.replace(/\bOCR\s+text\b/gi, "transcript").replace(/\s+/g, " ").trim();
  return s;
}

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
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s
      .replace(/\bOCR\s+issue[s]?\b/gi, "transcript formatting issue")
      .replace(/\bOCR\s+error[s]?\b/gi, "transcript error")
      .replace(/\b(?:an|the)\s+OCR\s+(?:issue|error|problem)\b/gi, "a transcript issue")
      .replace(/\bfrom\s+OCR\b/gi, "from the transcript")
      .replace(/\bdue\s+to\s+OCR\b/gi, "in the transcript")
      .replace(/\bOCR\s+text\b/gi, "transcript")
      .replace(/\bOCR[-\s]?generated\b/gi, "transcript")
      .replace(/\bthe\s+OCR\b/gi, "the transcript")
      .replace(/\s+/g, " ")
      .trim();
    if (s === before) break;
  }
  return s;
}

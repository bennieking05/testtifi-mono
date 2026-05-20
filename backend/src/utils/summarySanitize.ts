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
      .replace(/\b(?:optical\s+character\s+recognition|text\s+extraction)\s+(?:issue|issues|error|errors|problem|problems)\b/gi, "transcript formatting issue")
      .replace(/\bOCR\s+issue[s]?\b/gi, "transcript formatting issue")
      .replace(/\bOCR\s+error[s]?\b/gi, "transcript error")
      .replace(/\bOCR\s+problem[s]?\b/gi, "transcript issue")
      .replace(/\b(?:an|the)\s+OCR\s+(?:issue|error|problem)\b/gi, "a transcript issue")
      .replace(/\bfrom\s+OCR\b/gi, "from the transcript")
      .replace(/\bdue\s+to\s+OCR\b/gi, "in the transcript")
      .replace(/\bOCR\s+text\b/gi, "transcript")
      .replace(/\bOCR[-\s]?generated\b/gi, "transcript")
      .replace(/\bthe\s+OCR\b/gi, "the transcript")
      .replace(/\bscanned\s+text\b/gi, "transcript")
      .replace(/\bscanned\s+document\b/gi, "transcript")
      .replace(/\btext\s+extraction\b/gi, "transcript review")
      .replace(/\boptical\s+character\s+recognition\b/gi, "transcript review")
      .replace(/\s+/g, " ")
      .trim();
    if (s === before) break;
  }
  return s;
}

/** Rows matching these patterns are dropped from preview, downloads, and email attachments. */
export const META_COMMENTARY_PATTERNS: RegExp[] = [
  /\bpage\s+contain(?:ed|s)\s+(?:illegible|non[-\s]?substantive|minimal|empty|no\s+substantive)/i,
  /\bpage\s+contained\s+minimal\s+or\s+no\s+content\b/i,
  /\bminimal\s+or\s+no\s+content\b.*\bno\s+testimony\s+recorded\b/i,
  /\bno\s+testimony\s+recorded\b/i,
  /\billegible\s+(?:or\s+)?non[-\s]?substantive\s+content\b/i,
  /\bminimal\s+or\s+empty\s+content\b/i,
  /\b(no|minimal)\s+substantive\s+(?:content|testimony)\b/i,
  /\bprocedural\s+matters?,?\s*minimal\s+content/i,
  /^\s*\[?\s*LLM\s+did\s+not\s+summarize/i,
];

/**
 * True when the summary cell should not be shown to customers (placeholder, skip token, or meta-commentary).
 */
export function isNonSubstantiveSummary(summary: string): boolean {
  const s = (summary || "").trim();
  if (!s || s === "—") return true;
  if (/^__SKIP__$/i.test(s)) return true;
  return META_COMMENTARY_PATTERNS.some((re) => re.test(s));
}

/**
 * Remove deposition-overview sentences that are only meta/placeholder commentary
 * (same patterns as table-row filtering).
 */
export function sanitizeDepositionOverviewProse(text: string): string {
  const raw = (text || "").trim();
  if (!raw) return "";
  const blocks = raw.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const outBlocks = blocks.map((block) => {
    const sentences = block.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const kept = sentences.filter((sent) => !isNonSubstantiveSummary(sent));
    return kept.join(" ").trim();
  }).filter(Boolean);
  return outBlocks.join("\n\n").trim();
}

/**
 * Strip "in the case of …" phrasing when it echoes the internal upload title
 * (not a transcript-derived caption). Handles optional markdown emphasis around the name.
 */
export function stripInCaseOfInternalTitle(text: string, internalTitle: string | null | undefined): string {
  const t = (text || "").trim();
  const title = (internalTitle || "").trim();
  if (!t || !title) return t;
  const core = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const emphasis = "[*_']*";
  const re = new RegExp(
    `\\bin\\s+the\\s+case\\s+of\\s+${emphasis}${core}${emphasis}\\.?`,
    "gi"
  );
  return t
    .replace(re, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/  +/g, " ")
    .trim();
}

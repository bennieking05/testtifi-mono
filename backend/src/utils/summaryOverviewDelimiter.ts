/** Marker written by the summarize worker; used to split overview from page-line table. */
export const DEPOSITION_OVERVIEW_END = "<!-- TESTIFI_OVERVIEW_END -->";

const OVERVIEW_HEADING = /^#\s*Deposition overview\s*$/im;

/**
 * Remove the deposition overview block from stored markdown and return the overview text.
 * Legacy files without the delimiter are unchanged.
 */
export function splitDepositionOverview(md: string): {
  mdForTableParsing: string;
  depositionOverview: string | null;
} {
  const endIdx = md.indexOf(DEPOSITION_OVERVIEW_END);
  if (endIdx === -1) {
    return { mdForTableParsing: md, depositionOverview: null };
  }
  const before = md.slice(0, endIdx);
  const after = md.slice(endIdx + DEPOSITION_OVERVIEW_END.length).trimStart();
  const m = before.match(OVERVIEW_HEADING);
  let depositionOverview: string | null = null;
  let head = before;
  if (m && m.index !== undefined) {
    head = before.slice(0, m.index).trimEnd();
    depositionOverview = before.slice(m.index + m[0].length).trim() || null;
  }
  const mdForTableParsing = [head, after].filter(Boolean).join("\n\n");
  return { mdForTableParsing, depositionOverview };
}

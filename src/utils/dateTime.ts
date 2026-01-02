export const CST_TIME_ZONE = "America/Chicago";

export function formatDateInTimeZoneMDY(
  input: Date | string | number | null | undefined,
  timeZone: string = CST_TIME_ZONE
): string {
  if (input == null) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

export function parseLooseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\[?\s*unknown\s*\]?$/i.test(s)) return null;
  if (/^\[?\s*n\/a\s*\]?$/i.test(s)) return null;

  // If input contains extra words, try to extract a date-like substring first.
  const extracted =
    s.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+\d{4}\b/i
    )?.[0] ||
    s.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/)?.[0] ||
    s.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ||
    s;

  // Accept common deposition date strings: "July 7, 2022" or "7/7/2022"
  const d = new Date(extracted);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}




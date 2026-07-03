// src/worker/stages/metadataExtractor.ts
// Stage 2: Metadata Extractor - Extracts legal metadata from transcript text

import { extractTextWithVision } from "./pageCounter";

export interface MetadataResult {
  deponent: string;
  depositionDate: string;
  caseCaption: string;
  caseNumber: string | null;
  confidence: "high" | "medium" | "low";
  method: "text-parse" | "vision-ocr" | "hybrid";
}

export interface MetadataInput {
  transcript: string;
  gcsUri: string;
  jobId: string;
  pdfPageCount: number;
  fileData?: {
    title?: string;
    deponent?: string;
  };
}

/**
 * Stage 2: Extract legal metadata from the transcript.
 * Falls back to Vision OCR probe if cover page appears to be scanned.
 */
export async function extractMetadata(input: MetadataInput): Promise<MetadataResult> {
  const { transcript, gcsUri, jobId, pdfPageCount, fileData } = input;

  // First attempt: extract from text
  let result = extractLegalMetadata(transcript, fileData);
  let method: MetadataResult["method"] = "text-parse";
  let confidence: MetadataResult["confidence"] = "high";

  // Check if we got a valid deposition date
  const hasValidDate = result.depositionDate && !/^\[?\s*unknown\s*\]?$/i.test(result.depositionDate);
  const hasValidDeponent = result.deponent && !/^\[?\s*unknown\s*\]?$/i.test(result.deponent);

  // If deposition date wasn't extractable from text (common when cover page is an image),
  // run a Vision OCR probe on the first few PDF pages to recover it.
  if (!hasValidDate || !hasValidDeponent) {
    try {
      const headPages = [1, 2, 3].filter((n) => n <= pdfPageCount);
      const ocrHead = await extractTextWithVision(gcsUri, `${jobId}-metadata`, { pages: headPages });

      const probed = extractLegalMetadata(`${ocrHead}\n${transcript}`, fileData);

      // Keep any already-good fields, but adopt probed values if they improve
      if (probed.depositionDate && !/^\[?\s*unknown\s*\]?$/i.test(probed.depositionDate)) {
        result = { ...result, depositionDate: probed.depositionDate };
        method = "hybrid";
      }
      if (
        (!hasValidDeponent || result.deponent === "[Unknown]") &&
        probed.deponent &&
        !/^\[?\s*unknown\s*\]?$/i.test(probed.deponent)
      ) {
        result = { ...result, deponent: probed.deponent };
        method = "hybrid";
      }
      if (result.caseCaption.includes("[Unknown]") && !probed.caseCaption.includes("[Unknown]")) {
        result = { ...result, caseCaption: probed.caseCaption };
      }
      if ((!result.caseNumber || result.caseNumber === "[Unknown]") && probed.caseNumber) {
        result = { ...result, caseNumber: probed.caseNumber };
      }
    } catch (e) {
      console.warn(`[${jobId}] Vision metadata probe failed; continuing without it`);
      confidence = "low";
    }
  }

  // Determine confidence level
  const finalHasDate = result.depositionDate && !/^\[?\s*unknown\s*\]?$/i.test(result.depositionDate);
  const finalHasDeponent = result.deponent && !/^\[?\s*unknown\s*\]?$/i.test(result.deponent);

  if (finalHasDate && finalHasDeponent) {
    confidence = method === "text-parse" ? "high" : "medium";
  } else if (finalHasDate || finalHasDeponent) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  console.log(
    `[${jobId}] MetadataExtractor: deponent="${result.deponent}", date="${result.depositionDate}", ` +
      `method=${method}, confidence=${confidence}`
  );

  return {
    ...result,
    confidence,
    method,
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

interface LegalMetadataFields {
  caseCaption: string;
  caseNumber: string | null;
  deponent: string;
  depositionDate: string;
}

function cleanName(raw: string): string {
  return raw
    .replace(/[,;].*$/, "")
    .replace(/\b(a|an|the)\s+witness\b/i, "")
    .trim();
}

function looksLikePerson(value: string): boolean {
  const hasNumber = /\d/.test(value);
  if (hasNumber) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;

  const blacklist = [
    "north", "south", "east", "west",
    "street", "st", "st.", "avenue", "ave", "ave.", "road", "rd", "rd.", "lane", "ln", "ln.",
    "drive", "dr", "dr.", "boulevard", "blvd", "blvd.", "way", "court", "ct", "ct.",
    "plaza", "square", "sq", "sq.", "circle", "cir", "cir.", "floor", "fl", "fl.",
    "suite", "ste", "ste.", "unit", "apt", "apartment", "building", "bldg", "bldg.",
    "ri", "ma", "ct", "ny", "nj", "nh", "vt", "me", "pa", "de", "md", "va", "dc",
    "inc", "inc.", "llc", "l.l.c.", "ltd", "ltd.", "corp", "corp.", "co", "co.",
    "department", "dept", "dept.", "office", "offices", "division", "section",
  ];

  const hasBlacklistedWord = words.some((w) =>
    blacklist.includes(w.toLowerCase().replace(/[.,]$/, ""))
  );
  if (hasBlacklistedWord) return false;

  return words.every((w) => /^[A-Za-z.'-]+$/.test(w));
}

function sliceFirstPages(raw: string, maxPages: number): string {
  const parts = raw.split(/---PAGE\s+\d+---\s*\n/i);
  if (parts.length > 1) {
    return parts.slice(1, 1 + Math.max(1, maxPages)).join("\n");
  }
  return raw.split(/\r?\n/).slice(0, 2500).join("\n");
}

function extractDateToken(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  // Prefer explicit month-name dates first
  const m1 = s.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+\d{4}\b/i
  );
  if (m1) return m1[0].replace(/(\d)(st|nd|rd|th)\b/i, "$1");

  // Numeric dates
  const m2 = s.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/);
  if (m2) return m2[0];

  // ISO
  const m3 = s.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (m3) return m3[0];

  return null;
}

function normalizeUnknown(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\[?\s*unknown\s*\]?$/i.test(s)) return null;
  if (/^\[?\s*n\/a\s*\]?$/i.test(s)) return null;
  return s;
}

export function extractLegalMetadata(
  tr: string,
  fileData?: { title?: string; deponent?: string }
): LegalMetadataFields {
  const lines = tr.split(/\r?\n/);
  const header = sliceFirstPages(tr, 10);

  // Case number — support "Civil Action No. 1:22-cv-12345", "Case No. 12345", etc.
  const civMatch =
    header.match(
      /(?:CIVIL\s+ACTION\s+NO\.?|C\.A\.\s*NO\.?|CASE\s*NO\.?)\s*([\d]+:\d{2}-[a-z]{2}-\d+(?:-[A-Z]{2,})?)/i
    ) ||
    header.match(
      /(?:CIVIL\s+ACTION\s+NO\.?|C\.A\.\s*NO\.?|CASE\s*NO\.?)[^\w]*(\w[\w\-\/:]*)/i
    );
  const civil = civMatch?.[1]?.trim() || null;

  // Case caption — never use "Civil Action No. [Unknown]"
  const captionLine = lines.slice(0, 40).find((l) => /\b(v\.|vs\.|versus)\b/i.test(l)) || "";
  const caption =
    captionLine.trim() || (civil ? `Civil Action No. ${civil}` : "");

  // Deponent - comprehensive patterns to handle various transcript formats
  const deponentMatchers: Array<{ pattern: RegExp; name: string }> = [
    // explicit "Witness" in index
    { pattern: /WITNESS\s+PAGE\s+([A-Z\s\.]+)/i, name: "WITNESS PAGE" },
    { pattern: /WITNESS\s+([A-Z\s\.]+?)\s+PAGE/i, name: "WITNESS...PAGE" },
    { pattern: /WITNESS\s*\n\s*([A-Z\s\.]+)/i, name: "WITNESS newline" },
    // Videotaped/oral deposition variations
    { pattern: /\b(?:VIDEOTAPED|VIDEO)\s+DEPOSITION\s+OF\s+([^\n,]+)/i, name: "VIDEOTAPED DEPOSITION OF" },
    { pattern: /\bORAL\s+DEPOSITION\s+OF\s+([^\n,]+)/i, name: "ORAL DEPOSITION OF" },
    { pattern: /\bEXAMINATION\s+OF\s+([^\n,]+)/i, name: "EXAMINATION OF" },
    // RE: and IN RE: patterns (common in cover pages)
    { pattern: /\bRE:\s*(?:Deposition\s+of\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i, name: "RE:" },
    { pattern: /\bIN\s+RE:\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i, name: "IN RE:" },
    // standard headers
    { pattern: /continued\s+deposition\s+of\s+([^\n,]+)/i, name: "continued deposition of" },
    { pattern: /deposition\s+of\s+([^\n,]+)/i, name: "deposition of" },
    { pattern: /witness:\s*([^\n,]+)/i, name: "witness:" },
    { pattern: /deponent[:\s]+([^\n]+)/i, name: "deponent:" },
    // BEFORE/witness on same page
    { pattern: /\bTHE\s+WITNESS[:\s]+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i, name: "THE WITNESS:" },
  ];

  let extractedDeponent: string | null = null;
  for (const { pattern } of deponentMatchers) {
    const match = header.match(pattern);
    if (match && match[1]) {
      const candidate = cleanName(match[1]);
      if (candidate && looksLikePerson(candidate)) {
        extractedDeponent = candidate;
        break;
      }
    }
  }
  const deponent = extractedDeponent || fileData?.deponent || "[Unknown]";

  // Deposition date
  let extractedDate: string | null = null;

  // Handle line breaks and embedded line numbers in transcript text
  const cleanedHeader = header.replace(/\n\d{1,2}\s*/g, " ").replace(/\s+/g, " ");

  // HIGHEST PRIORITY: Look for explicit deposition date indicators first
  // These patterns directly indicate when the deposition was held
  const highPriorityDatePatterns: Array<{ pattern: RegExp; name: string }> = [
    // "was convened on July 7, 2022" - common in deposition openings
    { pattern: /\bconvened\s+(?:remotely\s+)?on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, name: "convened on" },
    // "commenced on July 7, 2022" or "commencing on July 7, 2022"
    { pattern: /\bcommenc(?:ed|ing)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, name: "commenced/commencing" },
    // "was held on July 7, 2022"
    { pattern: /\bwas\s+held\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, name: "was held on" },
    // "was taken on July 7, 2022"
    { pattern: /\bwas\s+taken\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, name: "was taken on" },
    // "at 10:05 a.m. on July 7, 2022"
    { pattern: /\bat\s+\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, name: "at time on date" },
    // TAKEN: July 7, 2022 (INDEX page)
    { pattern: /\bTAKEN\s*[:\-]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, name: "TAKEN:" },
  ];
  
  for (const { pattern, name } of highPriorityDatePatterns) {
    const match = cleanedHeader.match(pattern);
    if (match?.[1]) {
      const extracted = extractDateToken(match[1]) || match[1].trim();
      if (extracted) {
        extractedDate = extracted;
        console.log(`[DateExtraction] Found via HIGH PRIORITY "${name}": "${extractedDate}"`);
        break;
      }
    }
  }

  // Ordinal date patterns as fallback
  if (!extractedDate) {
  const ordinalDayOfMonth =
    /\b(?:on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(?:A\.D\.,?\s*)?(\d{4})\b/i;
  const ordMatch = cleanedHeader.match(ordinalDayOfMonth);
  if (ordMatch?.[1] && ordMatch?.[2] && ordMatch?.[3]) {
    const day = Number.parseInt(ordMatch[1], 10);
    const month = ordMatch[2];
    const year = ordMatch[3];
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      extractedDate = `${month} ${day}, ${year}`;
      }
    }
  }

  // Explicit date patterns - comprehensive list to handle various transcript formats
  const explicitDatePatterns: Array<{ pattern: RegExp; name: string }> = extractedDate
    ? []
    : [
        // Primary explicit patterns
        { pattern: /\bDate\s+of\s+Deposition\s*[:\-]\s*([^\n\r]+)/i, name: "Date of Deposition" },
        { pattern: /\bDeposition\s+Date\s*[:\-]\s*([^\n\r]+)/i, name: "Deposition Date" },
        { pattern: /\bDate\s+of\s+Examination\s*[:\-]\s*([^\n\r]+)/i, name: "Date of Examination" },
        { pattern: /\bDATE\s+TAKEN\s*[:\-]\s*([^\n\r]+)/i, name: "DATE TAKEN" },
        { pattern: /\bDATED\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "DATED" },
        { pattern: /\bRECORDED\s+(?:ON\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "RECORDED ON" },
        // Date: followed by various formats
        { pattern: /\bDate\s*[:\-]\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i, name: "Date: Month Day, Year" },
        { pattern: /\bDate\s*[:\-]\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "Date: MM/DD/YYYY" },
        { pattern: /\bDate\s*[:\-]\s*(\d{1,2}-\d{1,2}-\d{4})\b/i, name: "Date: MM-DD-YYYY" },
        // Taken on patterns
        { pattern: /\bTaken\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i, name: "Taken on" },
        { pattern: /\bTaken\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "Taken on MM/DD/YYYY" },
        { pattern: /\bTaken\s+on\s+(\d{1,2}-\d{1,2}-\d{4})\b/i, name: "Taken on MM-DD-YYYY" },
        // Held on patterns
        { pattern: /\bHeld\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i, name: "Held on" },
        { pattern: /\bHeld\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "Held on MM/DD/YYYY" },
        { pattern: /\bHeld\s+on\s+(\d{1,2}-\d{1,2}-\d{4})\b/i, name: "Held on MM-DD-YYYY" },
        // INDEX page patterns
        { pattern: /\bTAKEN[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "TAKEN" },
        { pattern: /\bTAKEN[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "TAKEN MM/DD/YYYY" },
        // Commencing patterns
        { pattern: /\bcommencing\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i, name: "commencing" },
        { pattern: /\bcommencing\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\b/i, name: "commencing MM/DD/YYYY" },
        // European format: "7 July 2022" (no comma)
        { pattern: /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i, name: "European Day Month Year" },
      ];

  for (const { pattern, name } of explicitDatePatterns) {
    const match = cleanedHeader.match(pattern);
    if (match?.[1]) {
      // Handle European format specially (returns 3 groups)
      if (name === "European Day Month Year" && match[2] && match[3]) {
        extractedDate = `${match[2]} ${match[1]}, ${match[3]}`;
        break;
      }
      extractedDate = extractDateToken(match[1]) || match[1].trim();
      break;
    }
  }

  // Fallback: search for a plausible date near the top
  if (!extractedDate) {
    extractedDate = extractDateToken(header);
  }

  // Cross-validate: OCR can misread "7th" as "6th". Check multiple sources.
  // The explicit "Month Day, Year" format is less prone to OCR errors than ordinal forms.
  if (extractedDate) {
    const extractedParts = extractedDate.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (extractedParts) {
      const [, month, day, year] = extractedParts;
      const dayNum = parseInt(day, 10);
      
      // Check if adjacent days appear explicitly in the full transcript (not ordinal form)
      // Use full transcript to catch dates mentioned in opening statements, etc.
      const searchText = tr.slice(0, 50000); // First ~50K chars to avoid performance issues
      const adjacentDays = [dayNum - 1, dayNum, dayNum + 1].filter(d => d >= 1 && d <= 31);
      const explicitDateCounts: { [key: number]: number } = {};
      
      for (const d of adjacentDays) {
        // Count explicit "Month Day, Year" patterns (not ordinal)
        const explicitPattern = new RegExp(`\\b${month}\\s+${d},?\\s+${year}\\b`, 'gi');
        const matches = searchText.match(explicitPattern);
        explicitDateCounts[d] = matches ? matches.length : 0;
      }
      
      // Also check for "taken on [date]" or "deposition ... [date]" phrases
      // which are highly reliable indicators of the actual deposition date
      for (const d of adjacentDays) {
        const takenOnPattern = new RegExp(`\\b(?:taken|deposition)\\b[^.]{0,50}\\b${month}\\s+${d},?\\s+${year}\\b`, 'gi');
        const takenMatches = searchText.match(takenOnPattern);
        if (takenMatches) {
          // "taken on" phrases are highly reliable, weight them 10x
          explicitDateCounts[d] = (explicitDateCounts[d] || 0) + takenMatches.length * 10;
        }
      }
      
      // Find the most common explicit date in adjacent range
      const mostCommonDay = Object.entries(explicitDateCounts)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])[0];
      
      if (mostCommonDay && parseInt(mostCommonDay[0]) !== dayNum) {
        const correctedDate = `${month} ${mostCommonDay[0]}, ${year}`;
        console.log(`[DateExtraction] Cross-validation: Extracted "${extractedDate}" but "${correctedDate}" appears more reliably (score: ${mostCommonDay[1]} vs ${explicitDateCounts[dayNum] || 0}). Using corrected date.`);
        extractedDate = correctedDate;
      }
    }
  }

  const date = normalizeUnknown(extractedDate) || "[Unknown]";

  return {
    caseCaption: caption,
    caseNumber: civil,
    deponent,
    depositionDate: date,
  };
}


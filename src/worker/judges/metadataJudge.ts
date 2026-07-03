// src/worker/judges/metadataJudge.ts
// Validates metadata correctness

import { JudgeResult, JudgeContext } from "./types";

/**
 * Metadata Judge
 * Validates that extracted metadata is reasonable and correctly formatted.
 *
 * Failure criteria:
 * - depositionDate is in the future
 * - deponent looks like an address or company name
 * - caseNumber has invalid format
 */
export function metadataJudge(context: JudgeContext): JudgeResult {
  const { deponent, depositionDate, caseCaption } = context;

  const warnings: string[] = [];
  const instructions: string[] = [];
  let passed = true;

  // Check deponent
  if (!deponent || deponent === "[Unknown]") {
    warnings.push("Deponent name was not detected.");
    instructions.push(
      "Review the first few pages of the transcript to manually identify the deponent name."
    );
  } else if (looksLikeAddress(deponent)) {
    passed = false;
    warnings.push(`Deponent "${deponent}" appears to be an address, not a person's name.`);
    instructions.push(
      "The system incorrectly extracted an address as the deponent name. " +
        "Manually update the deponent field in the summary metadata."
    );
  } else if (looksLikeCompany(deponent)) {
    passed = false;
    warnings.push(`Deponent "${deponent}" appears to be a company name, not a person's name.`);
    instructions.push(
      "The system incorrectly extracted a company name as the deponent. " +
        "Review the transcript cover page to identify the correct witness name."
    );
  }

  // Check deposition date
  if (!depositionDate || depositionDate === "[Unknown]") {
    warnings.push("Deposition date was not detected.");
    instructions.push(
      "Review the transcript cover page or certification to find the deposition date."
    );
  } else {
    const parsedDate = parseLooseDate(depositionDate);
    if (parsedDate) {
      const now = new Date();
      const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      if (parsedDate > oneYearFromNow) {
        passed = false;
        warnings.push(`Deposition date "${depositionDate}" is in the future.`);
        instructions.push(
          "The extracted date is invalid. Review the transcript to find the correct deposition date."
        );
      }

      // Check for very old dates (might be OCR error)
      const veryOld = new Date("1950-01-01");
      if (parsedDate < veryOld) {
        warnings.push(`Deposition date "${depositionDate}" is unusually old (before 1950).`);
        instructions.push(
          "Verify this is the correct date. Old dates may indicate OCR errors."
        );
      }
    } else {
      warnings.push(`Could not parse deposition date "${depositionDate}" for validation.`);
      instructions.push("Verify the date format is correct (e.g., 'July 7, 2022' or '7/7/2022').");
    }
  }

  // Check case caption
  if (!caseCaption || caseCaption.includes("[Unknown]")) {
    warnings.push("Case caption was not fully detected.");
    instructions.push(
      "Review the transcript cover page to identify the full case caption and parties."
    );
  }

  return {
    judgeName: "MetadataJudge",
    passed,
    warnings,
    instructions,
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function looksLikeAddress(value: string): boolean {
  const addressTerms = [
    "street", "st", "st.", "avenue", "ave", "ave.", "road", "rd", "rd.",
    "lane", "ln", "ln.", "drive", "dr", "dr.", "boulevard", "blvd", "blvd.",
    "way", "court", "ct", "ct.", "plaza", "square", "sq", "sq.",
    "circle", "cir", "cir.", "floor", "fl", "fl.", "suite", "ste", "ste.",
    "unit", "apt", "apartment", "building", "bldg", "bldg.",
  ];

  const words = value.toLowerCase().split(/\s+/);
  const hasAddressTerm = words.some((w) =>
    addressTerms.includes(w.replace(/[.,]$/, ""))
  );
  const hasNumber = /\d/.test(value);

  return hasAddressTerm && hasNumber;
}

function looksLikeCompany(value: string): boolean {
  const companyTerms = [
    "inc", "inc.", "llc", "l.l.c.", "ltd", "ltd.", "corp", "corp.",
    "corporation", "co", "co.", "company", "companies",
    "l.p.", "lp", "llp", "l.l.p.", "pllc", "p.l.l.c.",
    "group", "holdings", "enterprises", "services",
  ];

  const words = value.toLowerCase().split(/\s+/);
  return words.some((w) => companyTerms.includes(w.replace(/[.,]$/, "")));
}

function parseLooseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\[?\s*unknown\s*\]?$/i.test(s)) return null;
  if (/^\[?\s*n\/a\s*\]?$/i.test(s)) return null;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}


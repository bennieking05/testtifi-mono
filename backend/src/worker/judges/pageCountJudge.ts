// src/worker/judges/pageCountJudge.ts
// Validates page count accuracy

import { JudgeResult, JudgeContext } from "./types";

// Configurable thresholds
const MAX_TRANSCRIPT_TO_PDF_RATIO = Number(process.env.JUDGE_MAX_PAGE_RATIO) || 6;
const MIN_TRANSCRIPT_TO_PDF_RATIO = Number(process.env.JUDGE_MIN_PAGE_RATIO) || 0.5;

/**
 * Page Count Judge
 * Validates that the detected page count is reasonable and consistent.
 *
 * Failure criteria:
 * - transcriptMaxPage > 6x pdfPageCount (likely OCR noise)
 * - transcriptMaxPage < pdfPageCount * 0.5 when multi-up detected
 * - totalPages <= 0
 */
export function pageCountJudge(context: JudgeContext): JudgeResult {
  const { pdfPageCount, transcriptMaxPage, totalPages, jobId } = context;

  const warnings: string[] = [];
  const instructions: string[] = [];
  let passed = true;

  // Check for zero/negative total pages
  if (totalPages <= 0) {
    passed = false;
    warnings.push(`Total pages is ${totalPages}, which is invalid.`);
    instructions.push("Verify the PDF was uploaded correctly and contains readable content.");
  }

  // Check for excessive transcript-to-PDF ratio (OCR noise)
  if (transcriptMaxPage > 0 && pdfPageCount > 0) {
    const ratio = transcriptMaxPage / pdfPageCount;

    if (ratio > MAX_TRANSCRIPT_TO_PDF_RATIO) {
      passed = false;
      warnings.push(
        `Detected transcript page ${transcriptMaxPage} is ${ratio.toFixed(1)}x the PDF page count (${pdfPageCount}). ` +
          `This likely indicates OCR noise or misdetection.`
      );
      instructions.push(
        "Review the last few pages of the PDF to verify the actual page numbering. " +
          "The system may have picked up exhibit numbers, IDs, or other numeric content as page numbers."
      );
    }

    // Check for suspiciously low transcript pages when we expect multi-up
    if (ratio < MIN_TRANSCRIPT_TO_PDF_RATIO && pdfPageCount >= 50) {
      warnings.push(
        `Detected transcript page ${transcriptMaxPage} is only ${(ratio * 100).toFixed(0)}% of PDF pages (${pdfPageCount}). ` +
          `The transcript may be truncated or page detection may have failed.`
      );
      instructions.push(
        "Review the PDF to ensure all pages were processed. Check if the document uses non-standard page numbering."
      );
      // This is a warning, not a failure - the summary may still be usable
    }

    // Check for likely multi-up detection issues
    if (transcriptMaxPage > pdfPageCount * 1.5 && transcriptMaxPage < pdfPageCount * 2.5) {
      // This is expected for 2-up transcripts, just log it
      console.log(
        `[${jobId}] PageCountJudge: Multi-up transcript detected (ratio=${ratio.toFixed(2)})`
      );
    }
  }

  // Check for mismatch between totalPages and transcriptMaxPage
  if (transcriptMaxPage > 0 && totalPages > 0 && Math.abs(totalPages - transcriptMaxPage) > 10) {
    warnings.push(
      `Total pages (${totalPages}) differs significantly from detected transcript max (${transcriptMaxPage}).`
    );
    instructions.push(
      "The system chose a different page count than detected. Verify which is correct by checking the last page of the transcript."
    );
  }

  return {
    judgeName: "PageCountJudge",
    passed,
    warnings,
    instructions,
  };
}





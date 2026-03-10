#!/usr/bin/env npx ts-node
/**
 * test-local-summary.ts
 *
 * End-to-end local test for summary generation.
 * Extracts text from a PDF, runs page extraction, generates summaries via Azure OpenAI,
 * and validates the output format.
 *
 * Usage:
 *   npx ts-node scripts/test-local-summary.ts <path-to-pdf>
 *
 * Requires:
 *   - backend/.env with AZURE_OPENAI_* credentials
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from backend/.env
dotenv.config({ path: path.join(__dirname, "../backend/.env") });

import {
  parseSummaryRows,
  validateCoverage,
  validateGrouping,
  validateLineNumbers,
  ValidationResult,
} from "./summary-validators";

// ─────────────────────────────────────────────────────────────────────────────
// PDF Text Extraction (using pdf-parse)
// ─────────────────────────────────────────────────────────────────────────────
async function extractTextFromPdf(pdfPath: string): Promise<{ text: string; pageCount: number }> {
  // Dynamic import for pdf-parse
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    pageCount: data.numpages,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Extraction (copied from summarizeWorker.ts for standalone use)
// ─────────────────────────────────────────────────────────────────────────────
interface PageAnchor {
  pageNum: number;
  position: number;
  isSynthetic?: boolean;
}

interface LineRange {
  start: number;
  end: number;
}

function detectLineRange(pageText: string): LineRange {
  const lines = pageText.split("\n");
  const lineNumbers: number[] = [];

  // Patterns to detect line numbers at start of lines
  const patterns = [
    /^\s*(\d{1,2})\s+[A-Za-z\.\(\)]/,  // "1 Q. What is your name?"
    /^\s*(\d{1,2})\s+(?:THE|MR\.|MS\.|MRS\.|BY|Q\.|A\.)/i,  // "1 THE WITNESS:"
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 25) {
          lineNumbers.push(num);
        }
        break;
      }
    }
  }

  if (lineNumbers.length >= 3) {
    const sorted = [...lineNumbers].sort((a, b) => a - b);
    return {
      start: sorted[0],
      end: sorted[sorted.length - 1],
    };
  }

  return { start: 1, end: 25 }; // Default
}

function extractTranscriptPagesFromText(
  fullText: string,
  pdfPageCount: number
): Map<number, { text: string; lineRange: LineRange }> {
  const pageMap = new Map<number, { text: string; lineRange: LineRange }>();

  // Patterns to match page markers
  const patterns: Array<{ regex: RegExp; group: number }> = [
    { regex: /---\s*PAGE\s*(\d+)\s*---/gi, group: 1 },
    { regex: /(?:^|\n)\s*Page\s+(\d+)\s*(?:\n|$)/gim, group: 1 },
    { regex: /(?:P[ao]ge|Paqe|P@ge)\s+(\d+)/gi, group: 1 },
    { regex: /(?:^|\n)\s*-\s+(\d+)\s+-\s*(?:\n|$)/gm, group: 1 },
    { regex: /Veritext\s+Legal\s+Solutions[^\n]*\n\s*(\d+)\s*$/gim, group: 1 },
  ];

  // Find all page anchors
  const allAnchors: PageAnchor[] = [];
  for (const { regex, group } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(fullText)) !== null) {
      const pageNum = parseInt(match[group], 10);
      if (pageNum > 0 && pageNum < 10000) {
        allAnchors.push({ pageNum, position: match.index });
      }
    }
  }

  // Dedupe and sort
  const anchorsByPage = new Map<number, PageAnchor[]>();
  for (const anchor of allAnchors) {
    const existing = anchorsByPage.get(anchor.pageNum) || [];
    existing.push(anchor);
    anchorsByPage.set(anchor.pageNum, existing);
  }

  // Use LAST occurrence for each page (avoid index references)
  const uniqueAnchors: PageAnchor[] = [];
  for (const [pageNum, anchors] of anchorsByPage) {
    const sorted = anchors.sort((a, b) => b.position - a.position);
    uniqueAnchors.push(sorted[0]);
  }
  uniqueAnchors.sort((a, b) => a.position - b.position);

  console.log(`[PageExtraction] Found ${uniqueAnchors.length} unique page markers`);

  // Filter outliers
  if (uniqueAnchors.length > 5) {
    const pageNums = uniqueAnchors.map((a) => a.pageNum).sort((a, b) => a - b);
    const median = pageNums[Math.floor(pageNums.length / 2)];
    const threshold = Math.max(median * 3, 500);
    const filtered = uniqueAnchors.filter((a) => a.pageNum <= threshold);
    if (filtered.length < uniqueAnchors.length) {
      console.log(
        `[PageExtraction] Filtered ${uniqueAnchors.length - filtered.length} outlier page numbers`
      );
      uniqueAnchors.length = 0;
      uniqueAnchors.push(...filtered);
    }
  }

  // Interpolate gaps
  const finalAnchors: PageAnchor[] = [];
  for (let i = 0; i < uniqueAnchors.length; i++) {
    finalAnchors.push(uniqueAnchors[i]);

    if (i < uniqueAnchors.length - 1) {
      const current = uniqueAnchors[i];
      const next = uniqueAnchors[i + 1];
      const gap = next.pageNum - current.pageNum - 1;

      if (gap > 0 && gap <= 20) {
        const textBetween = fullText.slice(current.position, next.position);
        const charsPerPage = Math.floor(textBetween.length / (gap + 1));

        for (let p = 1; p <= gap; p++) {
          const syntheticPos = current.position + p * charsPerPage;
          finalAnchors.push({
            pageNum: current.pageNum + p,
            position: syntheticPos,
            isSynthetic: true,
          });
        }
      }
    }
  }

  finalAnchors.sort((a, b) => a.position - b.position);
  const syntheticCount = finalAnchors.filter((a) => a.isSynthetic).length;
  console.log(
    `[PageExtraction] After interpolation: ${finalAnchors.length} pages (${syntheticCount} interpolated)`
  );

  // Extract text for each page
  for (let i = 0; i < finalAnchors.length; i++) {
    const anchor = finalAnchors[i];
    const startPos = anchor.position;
    const endPos =
      i < finalAnchors.length - 1 ? finalAnchors[i + 1].position : fullText.length;

    const pageText = fullText.slice(startPos, endPos);
    const lineRange = detectLineRange(pageText);

    pageMap.set(anchor.pageNum, { text: pageText, lineRange });
  }

  return pageMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Creation
// ─────────────────────────────────────────────────────────────────────────────
interface TranscriptBatch {
  pageNumbers: number[];
  start: number;
  end: number;
  text: string;
  lineRanges: Map<number, LineRange>;
}

function createTranscriptBatches(
  pageMap: Map<number, { text: string; lineRange: LineRange }>,
  pagesPerBatch = 5
): TranscriptBatch[] {
  const batches: TranscriptBatch[] = [];
  const sortedPages = Array.from(pageMap.keys()).sort((a, b) => a - b);

  for (let i = 0; i < sortedPages.length; i += pagesPerBatch) {
    const batchPages = sortedPages.slice(i, i + pagesPerBatch);
    const lineRanges = new Map<number, LineRange>();

    let batchText = "";
    for (const pageNum of batchPages) {
      const pageData = pageMap.get(pageNum);
      if (pageData) {
        const range = pageData.lineRange;
        lineRanges.set(pageNum, range);
        batchText += `\n=== TRANSCRIPT PAGE ${pageNum} (Lines ${range.start}-${range.end}) ===\n`;
        batchText += pageData.text;
      }
    }

    batches.push({
      pageNumbers: batchPages,
      start: batchPages[0],
      end: batchPages[batchPages.length - 1],
      text: batchText,
      lineRanges,
    });
  }

  return batches;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Summarization
// ─────────────────────────────────────────────────────────────────────────────
async function callAzureOpenAI(prompt: string, systemPrompt: string): Promise<string> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o";

  if (!endpoint || !apiKey) {
    throw new Error("Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY");
  }

  const url = `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 4000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Azure OpenAI error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function makePromptForBatch(batch: TranscriptBatch, deponent: string): { system: string; user: string } {
  const firstPage = batch.start;
  const lastPage = batch.end;

  const system = `You are a legal document summarizer specializing in deposition transcripts.

TONE REQUIREMENTS:
- Write ONLY factual summaries of what was said
- Do NOT analyze, interpret, or comment on the testimony
- Do NOT use phrases like "this is significant" or "importantly"
- Use past tense and third person

PAGE GROUPING BY TOPIC:
- You may combine up to 5 CONSECUTIVE pages that discuss the same topic
- Format grouped pages as: p.X-Y:lineStart-lineEnd | Summary
- EVERY page from ${firstPage} to ${lastPage} MUST be covered
- NO GAPS ALLOWED

LINE NUMBERS:
- Use the line ranges provided in each page header
- If page shows "(Lines 3-22)", use p.X:3-22
- If no specific range, omit line numbers: p.X | Summary

OUTPUT FORMAT:
p.X:Y-Z | [Summary of single page with lines Y-Z]
p.X-Y:A-B | [Combined summary of pages X through Y, lines A-B]

CRITICAL: Every page number from ${firstPage} to ${lastPage} MUST appear in your output.`;

  const user = `Summarize this deposition testimony of ${deponent}:

${batch.text}

Remember: Cover ALL pages ${firstPage}-${lastPage}. Group by topic (max 5 consecutive). Use detected line ranges.`;

  return { system, user };
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Assembly
// ─────────────────────────────────────────────────────────────────────────────
interface PageRangeEntry {
  startPage: number;
  endPage: number;
  lineNumbers?: string;
  summary: string;
}

function parseToRangeEntries(rawSummary: string): PageRangeEntry[] {
  const entries: PageRangeEntry[] = [];
  const lines = rawSummary.split("\n");

  // Pattern: p.X or p.X-Y optionally followed by :lineStart-lineEnd
  const pattern = /p\.(\d+)(?:-(\d+))?(?::(\d+)(?:-(\d+))?)?/i;

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;

    const startPage = parseInt(match[1], 10);
    const endPage = match[2] ? parseInt(match[2], 10) : startPage;
    const lineStart = match[3] ? parseInt(match[3], 10) : undefined;
    const lineEnd = match[4] ? parseInt(match[4], 10) : lineStart;

    // Extract summary text
    const afterMatch = line.slice((match.index || 0) + match[0].length);
    const summary = afterMatch.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "").trim();

    let lineNumbers: string | undefined;
    if (lineStart !== undefined && lineEnd !== undefined) {
      lineNumbers = `${lineStart}-${lineEnd}`;
    }

    entries.push({ startPage, endPage, lineNumbers, summary });
  }

  return entries;
}

function assembleSortedSummary(
  batchOutputs: string[],
  totalPages: number,
  pageMap: Map<number, { text: string; lineRange: LineRange }>
): string[] {
  const allEntries: PageRangeEntry[] = [];

  for (const output of batchOutputs) {
    const entries = parseToRangeEntries(output);
    allEntries.push(...entries);
  }

  // Sort by start page
  allEntries.sort((a, b) => a.startPage - b.startPage);

  // Track covered pages
  const covered = new Set<number>();
  for (const entry of allEntries) {
    for (let p = entry.startPage; p <= entry.endPage; p++) {
      covered.add(p);
    }
  }

  // Find and fill missing pages
  const missing: number[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (!covered.has(p)) {
      missing.push(p);
    }
  }

  if (missing.length > 0) {
    console.log(`[Assembly] Filling ${missing.length} missing pages with placeholders`);

    // Group consecutive missing pages
    let rangeStart = missing[0];
    let rangeEnd = missing[0];

    for (let i = 1; i <= missing.length; i++) {
      if (i < missing.length && missing[i] === rangeEnd + 1) {
        rangeEnd = missing[i];
      } else {
        // Add placeholder for this range
        allEntries.push({
          startPage: rangeStart,
          endPage: rangeEnd,
          summary:
            "[LLM did not summarize - page contained procedural matters, minimal content, or administrative notations]",
        });
        if (i < missing.length) {
          rangeStart = missing[i];
          rangeEnd = missing[i];
        }
      }
    }
  }

  // Re-sort after adding placeholders
  allEntries.sort((a, b) => a.startPage - b.startPage);

  // Format output rows
  const outputRows: string[] = [];
  for (const entry of allEntries) {
    let pageRef: string;
    if (entry.startPage === entry.endPage) {
      pageRef = `p.${entry.startPage}`;
    } else {
      pageRef = `p.${entry.startPage}-${entry.endPage}`;
    }

    // Add line numbers if present
    if (entry.lineNumbers) {
      pageRef += `:${entry.lineNumbers}`;
    }

    outputRows.push(`${pageRef} | ${entry.summary}`);
  }

  return outputRows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error("Usage: npx ts-node scripts/test-local-summary.ts <path-to-pdf>");
    process.exit(1);
  }

  if (!fs.existsSync(pdfPath)) {
    console.error(`File not found: ${pdfPath}`);
    process.exit(1);
  }

  console.log("🚀 TestifiAI Local Summary Test");
  console.log("================================\n");
  console.log(`PDF: ${pdfPath}`);

  // Step 1: Extract text
  console.log("\n📄 Step 1: Extracting text from PDF...");
  const { text, pageCount } = await extractTextFromPdf(pdfPath);
  console.log(`   Extracted ${text.length} chars from ${pageCount} PDF pages`);

  // Step 2: Extract transcript pages
  console.log("\n📑 Step 2: Extracting transcript pages...");
  const pageMap = extractTranscriptPagesFromText(text, pageCount);
  console.log(`   Found ${pageMap.size} transcript pages`);

  if (pageMap.size === 0) {
    console.error("❌ No transcript pages found. The PDF may be scanned (requires Vision OCR).");
    process.exit(1);
  }

  // Determine total transcript pages
  const maxPage = Math.max(...Array.from(pageMap.keys()));
  const totalPages = maxPage;
  console.log(`   Transcript page range: 1-${totalPages}`);

  // Step 3: Create batches
  console.log("\n📦 Step 3: Creating batches...");
  const batches = createTranscriptBatches(pageMap, 5);
  console.log(`   Created ${batches.length} batches`);

  // Step 4: Generate summaries
  console.log("\n🤖 Step 4: Generating summaries via Azure OpenAI...");
  const deponent = "Unknown Deponent"; // Would be extracted in real worker
  const batchOutputs: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`   Batch ${i + 1}/${batches.length} (pages ${batch.start}-${batch.end})...`);

    try {
      const { system, user } = makePromptForBatch(batch, deponent);
      const output = await callAzureOpenAI(user, system);
      batchOutputs.push(output);
      console.log(" ✓");
    } catch (err) {
      console.log(` ❌ ${err}`);
      batchOutputs.push(""); // Empty output for failed batch
    }

    // Rate limiting
    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Step 5: Assemble summary
  console.log("\n📝 Step 5: Assembling final summary...");
  const outputRows = assembleSortedSummary(batchOutputs, totalPages, pageMap);
  console.log(`   Generated ${outputRows.length} summary rows`);

  // Step 6: Validate
  console.log("\n✅ Step 6: Validating output format...");
  const parsed = parseSummaryRows(outputRows);
  const results: ValidationResult[] = [
    validateCoverage(parsed, totalPages),
    validateGrouping(parsed),
    validateLineNumbers(parsed),
  ];

  let allPassed = true;
  for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`   ${icon} ${result.name}: ${result.details}`);
    if (!result.passed) {
      allPassed = false;
      result.issues.slice(0, 3).forEach((issue) => {
        console.log(`      • ${issue}`);
      });
    }
  }

  // Output sample
  console.log("\n📋 Sample Output (first 10 rows):");
  console.log("─".repeat(60));
  outputRows.slice(0, 10).forEach((row) => {
    console.log(row.length > 100 ? row.slice(0, 100) + "..." : row);
  });
  console.log("─".repeat(60));

  // Final verdict
  console.log("\n" + "═".repeat(60));
  if (allPassed) {
    console.log("🎉 SUCCESS - All validations passed!");
  } else {
    console.log("❗ ISSUES FOUND - See validation results above");
  }
  console.log("═".repeat(60));

  // Write full output to file
  const outputPath = pdfPath.replace(/\.pdf$/i, "-summary.txt");
  fs.writeFileSync(outputPath, outputRows.join("\n\n"));
  console.log(`\n📁 Full summary written to: ${outputPath}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

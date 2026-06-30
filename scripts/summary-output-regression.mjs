#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const requireFromRoot = createRequire(import.meta.url);

function loadBuiltModule(relativePath) {
  try {
    return requireFromRoot(path.join(root, relativePath));
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `Missing built module ${relativePath}. Run "npm run build" before npm run test:summary-output.`
      );
    }
    throw error;
  }
}

const {
  isRedundantLineNumberSuffix,
  stripRedundantFullPageLineSuffix,
} = loadBuiltModule("backend/dist/utils/pageLineDisplay.js");
const { sanitizeSummaryMetaLanguage } = loadBuiltModule("backend/dist/utils/summarySanitize.js");
const {
  DEPOSITION_OVERVIEW_END,
  splitDepositionOverview,
} = loadBuiltModule("backend/dist/utils/summaryOverviewDelimiter.js");
const { parseMarkdown } = loadBuiltModule("backend/dist/routes/downloadRoutes.js");
const { parseToRangeEntries, regroupIntoBlocks, assembleSortedSummary, findSkippedSubstantivePages } =
  loadBuiltModule("backend/dist/worker/summarizeWorker.js");

function assertNoInternalProcessLanguage(text) {
  assert.doesNotMatch(text, /\bOCR\b/i);
  assert.doesNotMatch(text, /\bscanned\s+(?:text|document)\b/i);
  assert.doesNotMatch(text, /\btext extraction\b/i);
  assert.doesNotMatch(text, /\boptical character recognition\b/i);
}

function testPageLineDisplay() {
  assert.equal(isRedundantLineNumberSuffix(":1-25"), true);
  assert.equal(isRedundantLineNumberSuffix(":2-25"), false);
  assert.equal(isRedundantLineNumberSuffix(":1-46"), false);

  assert.equal(stripRedundantFullPageLineSuffix("p.12:1-25"), "p.12");
  assert.equal(stripRedundantFullPageLineSuffix("p.12:1–25"), "p.12");
  assert.equal(stripRedundantFullPageLineSuffix("p.12:3-12"), "p.12:3-12");
}

function testSanitizeSummaryLanguage() {
  const sanitized = sanitizeSummaryMetaLanguage(
    "The OCR issue affected a scanned document, and text extraction errors were discussed."
  );

  assertNoInternalProcessLanguage(sanitized);
  assert.match(sanitized, /transcript/i);
}

function testOverviewSplitAndMarkdownParsing() {
  const markdown = [
    "Title of Document: Transcript Summary of Jane Doe",
    "",
    "# Deposition overview",
    "",
    "Jane Doe testified about the contract negotiations and the sequence of communications.",
    "",
    DEPOSITION_OVERVIEW_END,
    "",
    "| Page/Line | Topic | Summary |",
    "| --- | --- | --- |",
    "| p.10:1-25 | Contract Background | The witness testified about the contract negotiations. |",
    "| p.11:4-12 | Signature Block | The witness confirmed her signature on Exhibit 1. |",
  ].join("\n");

  const split = splitDepositionOverview(markdown);
  assert.equal(
    split.depositionOverview,
    "Jane Doe testified about the contract negotiations and the sequence of communications."
  );
  assert.doesNotMatch(split.mdForTableParsing, /# Deposition overview/i);

  const parsed = parseMarkdown(markdown, "Jane Doe");
  assert.equal(parsed.depositionOverview, split.depositionOverview);
  assert.deepEqual(parsed.meta, ["Title of Document: Transcript Summary of Jane Doe"]);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].pageLine, "p.10:1-25");
  assert.equal(parsed.rows[0].topic, "");
  assert.equal(parsed.rows[0].summary, "The witness testified about the contract negotiations.");
  assert.equal(parsed.rows[1].pageLine, "p.11:4-12");
  assert.equal(parsed.rows[1].summary, "The witness confirmed her signature on Exhibit 1.");
}

// R2: page ranges must not be silently truncated to start+10. Only pathological ranges
// (span > MAX_PARSED_RANGE_SPAN, default 50) are clamped, and clamping is logged.
function testRangeNotSilentlyTruncated() {
  const legit = parseToRangeEntries(
    "| p.5-20 | Smith testified at length about the contract and its performance over the relevant period. |"
  );
  assert.equal(legit.length, 1);
  assert.equal(legit[0].startPage, 5);
  assert.equal(legit[0].endPage, 20, "legitimate range p.5-20 must survive (was truncated to 15)");

  const huge = parseToRangeEntries(
    "| p.1-9999 | A hallucinated giant range that should be bounded rather than trusted as-is. |"
  );
  assert.equal(huge.length, 1);
  assert.equal(huge[0].startPage, 1);
  assert.equal(huge[0].endPage, 51, "pathological range clamped to start + MAX_PARSED_RANGE_SPAN(50)");
}

// UAT Round 44 Issue 1: rows must group into consistent ~5-6 page blocks (5:1 ratio),
// NOT 1-2 page or single-page rows.
function testRegroupMergesIntoBlocks() {
  const entries = [];
  for (let p = 1; p <= 12; p++) {
    entries.push({
      startPage: p,
      endPage: p,
      lineNumbers: "",
      summary: `Testimony on page ${p} about the matter at hand.`,
    });
  }
  const blocks = regroupIntoBlocks(entries, 5);

  // 12 single-page entries collapse into ~2-3 grouped blocks, not 12 rows.
  assert.ok(blocks.length <= 3, `12 pages should group into ~2-3 blocks, got ${blocks.length}`);
  // Every non-final block is a full ~5-page group (no 1-2 page rows except a trailing remainder).
  for (let i = 0; i < blocks.length - 1; i++) {
    const span = blocks[i].endPage - blocks[i].startPage + 1;
    assert.ok(span >= 5, `block p.${blocks[i].startPage}-${blocks[i].endPage} should group ~5 pages`);
  }
  assert.equal(blocks[0].startPage, 1, "first block starts at page 1");
  assert.equal(blocks[blocks.length - 1].endPage, 12, "full coverage preserved through grouping");

  // A block made entirely of placeholders stays a single "—" row (filtered downstream).
  const phBlocks = regroupIntoBlocks(
    [
      { startPage: 1, endPage: 1, lineNumbers: "", summary: "—" },
      { startPage: 2, endPage: 2, lineNumbers: "", summary: "—" },
    ],
    5
  );
  assert.ok(phBlocks.every((b) => b.summary === "—"), "placeholder-only block stays a gap row");
}

// R2: assembly clamps out-of-range pages to the document extent so a hallucinated range
// cannot claim coverage of pages that do not exist.
function testAssemblyClampsToDocumentExtent() {
  const { coveredPages } = assembleSortedSummary(
    ["| p.1-9999 | A hallucinated range spanning far beyond the document extent here. |"],
    [1, 2, 3, 4, 5]
  );
  assert.ok(coveredPages.length > 0);
  assert.ok(Math.max(...coveredPages) <= 5, "coverage must never exceed the document extent");
}

// 5:1 grouping: consecutive entries merge into one block range; a line suffix survives
// only when a block is a single original single-page (partial) entry.
function testAssemblyGroupsAndKeepsLinesForSinglePageBlocks() {
  // Two entries within one block window merge into a single grouped range row.
  const { markdown: merged } = assembleSortedSummary(
    [
      "| p.1:3-22 | Smith testified about the engagement letter on this page only. |\n| p.2-4 | Continuous testimony about the project timeline and key milestones. |",
    ],
    [1, 2, 3, 4]
  );
  assert.match(merged, /\| p\.1-4 \|/, "consecutive entries group into one block range");

  // A lone partial single page (its own block) keeps its line-number suffix.
  const { markdown: single } = assembleSortedSummary(
    ["| p.3:5-19 | Smith addressed only the fee schedule on this page. |"],
    [3]
  );
  assert.match(single, /\| p\.3:5-19 \|/, "a single-page partial block keeps its line suffix");
}

// R3: coverage guard flags pages that are non-substantive in the output but have
// substantive source text, and ignores pages that are genuinely empty or already covered.
function testFindSkippedSubstantivePages() {
  const markdown = [
    "| p.1-2 | — |", // skipped (caption-like)
    "| p.3 | Goodson testified about the employment agreement and commission structure. |",
    "| p.4 | — |", // skipped
    "| p.5 | — |", // skipped
  ].join("\n");
  const expected = [1, 2, 3, 4, 5];
  // p.4 has lots of text (substantive, wrongly skipped); p.1,2,5 are near-empty (genuine skips).
  const textLen = (p) => (p === 4 ? 800 : 10);

  const flagged = findSkippedSubstantivePages(markdown, expected, textLen, 200);
  assert.deepEqual(flagged, [4], "only the substantive-but-skipped page is flagged");

  // Nothing flagged when every skipped page is genuinely empty.
  assert.deepEqual(
    findSkippedSubstantivePages(markdown, expected, () => 10, 200),
    [],
    "genuinely empty skipped pages are not flagged"
  );

  // Covered substantive pages are never flagged even with long source text.
  assert.deepEqual(
    findSkippedSubstantivePages("| p.3 | Real substantive testimony here about the contract. |", [3], () => 5000, 200),
    [],
    "substantively covered pages are not flagged"
  );
}

testPageLineDisplay();
testSanitizeSummaryLanguage();
testOverviewSplitAndMarkdownParsing();
testRangeNotSilentlyTruncated();
testRegroupMergesIntoBlocks();
testAssemblyClampsToDocumentExtent();
testAssemblyGroupsAndKeepsLinesForSinglePageBlocks();
testFindSkippedSubstantivePages();

console.log("Summary output regression checks passed.");

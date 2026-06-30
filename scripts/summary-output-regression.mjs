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

// R1: substantive topic rows keep their model-chosen boundaries and line citations;
// only consecutive placeholder pages collapse.
function testRegroupPreservesTopicRowsAndLines() {
  const entries = [
    { startPage: 1, endPage: 1, lineNumbers: ":3-22", summary: "Partial-page testimony about the fee schedule and commissions." },
    { startPage: 2, endPage: 4, lineNumbers: "", summary: "Continuous testimony about the project timeline and milestones." },
    { startPage: 5, endPage: 5, lineNumbers: "", summary: "—" },
    { startPage: 6, endPage: 6, lineNumbers: "", summary: "—" },
    { startPage: 7, endPage: 9, lineNumbers: "", summary: "Testimony about damages and the supporting exhibits." },
  ];
  const blocks = regroupIntoBlocks(entries, 5);

  const substantive = blocks.filter((b) => b.summary !== "—");
  assert.equal(substantive.length, 3, "each substantive topic row is preserved (not force-merged)");

  const p1 = blocks.find((b) => b.startPage === 1 && b.endPage === 1);
  assert.ok(p1, "single-page topic row preserved");
  assert.equal(p1.lineNumbers, ":3-22", "line citation retained on single-page row");

  assert.ok(
    blocks.some((b) => b.startPage === 2 && b.endPage === 4),
    "multi-page range preserved as a range"
  );

  const placeholders = blocks.filter((b) => b.summary === "—");
  assert.equal(placeholders.length, 1, "adjacent placeholder pages merged into one gap row");
  assert.equal(placeholders[0].startPage, 5);
  assert.equal(placeholders[0].endPage, 6);
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

// R1: assembled output keeps a line suffix on single-page rows and a clean range otherwise.
function testAssemblyKeepsLineSuffixAndRanges() {
  const { markdown } = assembleSortedSummary(
    [
      "| p.1:3-22 | Smith testified about the engagement letter on this page only. |\n| p.2-4 | Continuous testimony about the project timeline and key milestones. |",
    ],
    [1, 2, 3, 4]
  );
  assert.match(markdown, /\| p\.1:3-22 \|/, "single-page partial row keeps its line suffix");
  assert.match(markdown, /\| p\.2-4 \|/, "continuous testimony rendered as a clean range");
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
testRegroupPreservesTopicRowsAndLines();
testAssemblyClampsToDocumentExtent();
testAssemblyKeepsLineSuffixAndRanges();
testFindSkippedSubstantivePages();

console.log("Summary output regression checks passed.");

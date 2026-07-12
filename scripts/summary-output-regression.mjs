#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
const {
  parseToRangeEntries,
  regroupIntoBlocks,
  assembleSortedSummary,
  findSkippedSubstantivePages,
  extractTranscriptPagesFromText,
} = loadBuiltModule("backend/dist/worker/summarizeWorker.js");

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

  // UAT R45 #4: NO row may exceed 6 pages.
  for (const b of blocks) {
    assert.ok(b.endPage - b.startPage + 1 <= 6, `block p.${b.startPage}-${b.endPage} exceeds 6 pages`);
  }

  // Two 4-page entries must NOT merge into one 8-page row (the old over-merge bug).
  const twoFour = regroupIntoBlocks(
    [
      { startPage: 6, endPage: 9, lineNumbers: "", summary: "Testimony about employment." },
      { startPage: 10, endPage: 13, lineNumbers: "", summary: "Testimony about the contract." },
    ],
    5
  );
  assert.ok(
    twoFour.every((b) => b.endPage - b.startPage + 1 <= 6),
    `two 4-page entries must not merge past 6 pages; got ${twoFour.map((b) => `p.${b.startPage}-${b.endPage}`).join(", ")}`
  );

  // A single oversized entry (e.g. an 8-page condensed row) is split into <=6-page rows.
  const oversized = regroupIntoBlocks(
    [{ startPage: 6, endPage: 13, lineNumbers: "", summary: "One condensed 8-page block." }],
    5
  );
  assert.ok(oversized.length >= 2, "an 8-page entry should split into >=2 rows");
  assert.ok(
    oversized.every((b) => b.endPage - b.startPage + 1 <= 6),
    "split rows must each be <=6 pages"
  );
  assert.equal(oversized[oversized.length - 1].endPage, 13, "split preserves full page coverage");

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

// UAT R45 #3: front matter before the first detected page anchor must NOT be dropped —
// it is assigned to page 1 so the summary starts at p.1 (appearances/stipulations covered).
function testHeadCoverageFromPageOne() {
  const fullText = [
    "APPEARANCES OF COUNSEL: Mr. Smith for Plaintiff; Ms. Jones for Defendant.",
    "STIPULATIONS: It is hereby stipulated by and between counsel that the deposition may proceed.",
    "Page 6",
    "Q. Please state your name for the record. A. John Doe.",
    "Page 7",
    "Q. Where are you employed? A. Acme Corporation.",
    "Page 8",
    "Q. For how long? A. Roughly ten years.",
  ].join("\n");

  const pageMap = extractTranscriptPagesFromText(fullText);

  assert.ok(pageMap.has(1), "front matter must be assigned to page 1, not dropped");
  assert.match(
    pageMap.get(1),
    /APPEARANCES/,
    "page 1 must carry the actual front-matter text (appearances/stipulations)"
  );
  for (let p = 2; p <= 5; p++) {
    assert.ok(pageMap.has(p), `head page ${p} must be present so coverage starts at p.1`);
  }
  assert.ok(pageMap.has(6), "the first detected anchor page is still captured");
}

// UAT R46 #1/#2: the customer-facing cover page must not show a "Case Title" line or a
// "Validation Warnings" section, and "Date of Deposition" must not repeat on the body page
// above the narrative. Verified behaviorally on a real generated DOCX, plus string tripwires
// on the built route files (PDF text is glyph-encoded, so it can't be asserted directly).
async function testCoverPageCustomerView() {
  const { generateDocxBuffer } = loadBuiltModule("backend/dist/utils/generateDocuments.js");
  const JSZip = requireFromRoot("jszip");

  const job = {
    id: "r46-job",
    fileName: "sackler-depo.pdf",
    createdAt: new Date("2026-07-01T12:00:00Z"),
    file: { title: "Sackler Depo", deponent: "Dr. Richard Sackler", pages: "12" },
  };
  const metadata = {
    deponent: "Dr. Richard Sackler",
    caseCaption: "PURDUE PHARMA L.P. v. STATE OF OKLAHOMA",
    caseTitle: "Sackler Matter",
    sourceFileName: "sackler-depo.pdf",
    totalPages: 12,
    depositionDate: "July 7, 2022",
    // A failing judge would previously render a Validation Warnings block on the cover.
    judgeResults: {
      allPassed: false,
      judges: [{ name: "Coverage", passed: false, warnings: ["Pages 3-4 may be under-summarized"] }],
    },
  };
  const documentData = {
    meta: [],
    depositionOverview: "Sackler testified about opioid marketing decisions.",
    rows: [
      { pageLine: "p.1-5", witness: "Dr. Richard Sackler", topic: "", summary: "Sackler described his role at the company." },
      { pageLine: "p.6-10", witness: "Dr. Richard Sackler", topic: "", summary: "Sackler discussed sales strategy." },
    ],
  };

  const docxBuf = await generateDocxBuffer(job, metadata, documentData, "");
  const zip = await JSZip.loadAsync(docxBuf);
  const xml = await zip.file("word/document.xml").async("string");

  assert.match(xml, /Source File/, "sanity: cover page still renders");
  assert.doesNotMatch(xml, /Case Title/i, "Case Title must not appear anywhere in the DOCX");
  assert.doesNotMatch(xml, /Validation Warning/i, "Validation Warnings must not appear in the DOCX");
  assert.equal(
    (xml.match(/Date of Deposition/g) || []).length,
    0,
    "the body-page 'Date of Deposition' line above the narrative must be gone (cover uses 'Date:')"
  );

  // Tripwires on the built HTTP-route code (download + preview render inline in the route).
  const downloadDist = readFileSync(path.join(root, "backend/dist/routes/downloadRoutes.js"), "utf-8");
  assert.doesNotMatch(downloadDist, /Case Title/i, "downloadRoutes must not render a Case Title line");
  assert.doesNotMatch(downloadDist, /Validation Warning/i, "downloadRoutes must not render Validation Warnings");
  const previewDist = readFileSync(path.join(root, "backend/dist/routes/previewRoutes.js"), "utf-8");
  assert.doesNotMatch(previewDist, /Validation Warning/i, "previewRoutes must not render Validation Warnings");
  assert.doesNotMatch(previewDist, /<strong>Case Title/i, "preview cover must not render a Case Title line");
  const generateDist = readFileSync(path.join(root, "backend/dist/utils/generateDocuments.js"), "utf-8");
  assert.doesNotMatch(generateDist, /Case Title/i, "generateDocuments must not render a Case Title line");
}

testHeadCoverageFromPageOne();
testPageLineDisplay();
testSanitizeSummaryLanguage();
testOverviewSplitAndMarkdownParsing();
testRangeNotSilentlyTruncated();
testRegroupMergesIntoBlocks();
testAssemblyClampsToDocumentExtent();
testAssemblyGroupsAndKeepsLinesForSinglePageBlocks();
testFindSkippedSubstantivePages();
await testCoverPageCustomerView();

console.log("Summary output regression checks passed.");

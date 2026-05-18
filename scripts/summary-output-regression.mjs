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

testPageLineDisplay();
testSanitizeSummaryLanguage();
testOverviewSplitAndMarkdownParsing();

console.log("Summary output regression checks passed.");

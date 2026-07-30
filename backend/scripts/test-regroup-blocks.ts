#!/usr/bin/env npx ts-node
/**
 * test-regroup-blocks.ts
 *
 * Unit test for the deterministic page-block regrouping added for UAT Round 44
 * (consistent ~5-page Page/Line designations). No external deps — run with:
 *   npx ts-node scripts/test-regroup-blocks.ts
 */

import { regroupIntoBlocks, assembleSortedSummary } from "../src/worker/summarizeWorker";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
    if (detail !== undefined) console.error("    got:", JSON.stringify(detail));
  }
}

const entry = (startPage: number, endPage: number, summary: string, lineNumbers = "") => ({
  startPage,
  endPage,
  lineNumbers,
  summary,
});

console.log("regroupIntoBlocks");

// 1. Many single-page entries collapse into 5-6 page blocks.
{
  const entries = [];
  for (let p = 12; p <= 23; p++) entries.push(entry(p, p, `Summary of page ${p}.`));
  const blocks = regroupIntoBlocks(entries, 5);
  const labels = blocks.map((b) => (b.startPage === b.endPage ? `p.${b.startPage}` : `p.${b.startPage}-${b.endPage}`));
  // pages 12..23 = 12 pages -> 12-16 (5), 17-21 (5), 22-23 (2)
  check("collapses 12 single pages into multi-page blocks", labels.length === 3, labels);
  check("first block is p.12-16", labels[0] === "p.12-16", labels[0]);
  check("second block is p.17-21", labels[1] === "p.17-21", labels[1]);
  check(
    "every block spans 2-6 pages (no stray single pages)",
    blocks.every((b) => {
      const span = b.endPage - b.startPage + 1;
      return span >= 2 && span <= 6;
    }),
    labels
  );
  check(
    "merged block concatenates source summaries",
    blocks[0].summary.includes("page 12") && blocks[0].summary.includes("page 16"),
    blocks[0].summary
  );
  check("merged ranges carry no line suffix", blocks.every((b) => b.lineNumbers === ""), blocks.map((b) => b.lineNumbers));
}

// 2. A lone trailing page is absorbed into the previous block (extends to 6).
{
  const entries = [];
  for (let p = 1; p <= 6; p++) entries.push(entry(p, p, `s${p}`));
  const blocks = regroupIntoBlocks(entries, 5);
  // 6 pages -> would be 1-5 + lone 6 -> absorbed into 1-6
  check("absorbs lone trailing page", blocks.length === 1 && blocks[0].startPage === 1 && blocks[0].endPage === 6, blocks);
}

// 3. Placeholder-only window stays "—"; mixed window keeps substantive text.
{
  const blocks = regroupIntoBlocks(
    [entry(1, 1, "—"), entry(2, 2, "—"), entry(3, 3, "—"), entry(4, 4, "—"), entry(5, 5, "—")],
    5
  );
  check("all-placeholder block stays —", blocks.length === 1 && blocks[0].summary === "—", blocks);

  const mixed = regroupIntoBlocks(
    [entry(1, 1, "—"), entry(2, 2, "real testimony"), entry(3, 3, "—"), entry(4, 4, "—"), entry(5, 5, "—")],
    5
  );
  check("mixed block keeps substantive text", mixed.length === 1 && mixed[0].summary === "real testimony", mixed);
}

// 4. Single-page leftover block preserves its cited line suffix.
{
  const blocks = regroupIntoBlocks(
    [entry(1, 1, "s1"), entry(2, 2, "s2"), entry(3, 3, "s3"), entry(4, 4, "s4"), entry(5, 5, "s5"), entry(7, 7, "lone", ":3-18")],
    5
  );
  // pages 1-5 form a block; page 7 is non-adjacent (gap at 6) so it is NOT absorbed and stays single
  const lone = blocks.find((b) => b.startPage === 7);
  check("non-adjacent single-page block kept", !!lone, blocks);
  check("single-page block preserves line suffix", lone?.lineNumbers === ":3-18", lone);
}

console.log("\nassembleSortedSummary end-to-end");

// 5. Coverage is unchanged by regrouping, and output rows are grouped.
{
  const llmOutputs = [
    [
      "| p.12 | Smith testified about employment. |",
      "| p.13 | Smith described the role. |",
      "| p.14 | Smith confirmed the contract. |",
      "| p.15 | Smith discussed compensation. |",
      "| p.16 | Smith addressed bonuses. |",
      "| p.17 | Smith reviewed exhibit 3. |",
    ].join("\n"),
  ];
  const expectedPages = [12, 13, 14, 15, 16, 17];
  const { markdown, coveredPages, missingPages } = assembleSortedSummary(llmOutputs, expectedPages);
  const rows = markdown.split("\n").filter((r) => r.trim().startsWith("|"));
  check("all expected pages covered", missingPages.length === 0, missingPages);
  check("coverage matches expected", coveredPages.join(",") === expectedPages.join(","), coveredPages);
  check("six single-page rows grouped into fewer rows", rows.length < 6, rows.length);
  check("first row is a multi-page range", /\| p\.12-\d+ \|/.test(rows[0]), rows[0]);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");

import fs from 'fs';
import path from 'path';
import process from 'process';
import xlsx from 'xlsx';

function usage() {
  console.error('Usage: node scripts/parse-uat-excel.mjs <input.xlsx> <output.json> <output.md>');
  process.exit(2);
}

const [,, inputPath, outJsonPath, outMdPath] = process.argv;
if (!inputPath || !outJsonPath || !outMdPath) usage();

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const workbook = xlsx.readFile(inputPath, { cellDates: true });
const report = [];
const allSheets = {};

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
  allSheets[sheetName] = rows;
  report.push({ sheet: sheetName, rows: rows.length, columns: Array.from(new Set(rows.flatMap(r => Object.keys(r)))) });
}

// Write JSON (all sheets)
fs.writeFileSync(outJsonPath, JSON.stringify({ source: path.basename(inputPath), sheets: allSheets }, null, 2));

// Write Markdown summary
let md = `# UAT Round 3 — Parsed Summary\n\n- Source: ${path.basename(inputPath)}\n- Generated: ${new Date().toISOString()}\n\n`;
for (const entry of report) {
  md += `## Sheet: ${entry.sheet}\n- Rows: ${entry.rows}\n- Columns: ${entry.columns.join(', ') || '(none)'}\n\n`;
  const sample = (allSheets[entry.sheet] || []).slice(0, 5);
  if (sample.length) {
    md += `Sample (first ${sample.length}):\n`;
    for (const row of sample) {
      md += `- ${JSON.stringify(row)}\n`;
    }
    md += `\n`;
  }
}
fs.writeFileSync(outMdPath, md);

console.log(`Wrote JSON: ${outJsonPath}`);
console.log(`Wrote Markdown: ${outMdPath}`);

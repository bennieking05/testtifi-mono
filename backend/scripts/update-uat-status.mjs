import fs from 'fs';
import path from 'path';
import process from 'process';
import xlsx from 'xlsx';

function usage() {
  console.error('Usage: node scripts/update-uat-status.mjs <input.xlsx>');
  process.exit(2);
}

const [,, inPath] = process.argv;
if (!inPath) usage();
if (!fs.existsSync(inPath)) {
  console.error(`Input not found: ${inPath}`);
  process.exit(1);
}

const wb = xlsx.readFile(inPath);
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(ws, { defval: null });

const now = new Date().toISOString();

function set(row, key, val){ row[key] = val; }

for (const row of rows) {
  const issue = String(row['Issue'] || '').trim();
  if (!issue) continue;

  if (/get notified when ready/i.test(issue)) {
    set(row, 'Status', 'Fixed (code)');
    set(row, 'Comment', 'Email opt-in uses authenticated API; worker emails on completion when notifyOnComplete=true and email template exists. Requires SENDGRID_API_KEY, EMAIL_USER, BASE_URL.');
    set(row, 'Evidence', 'FE: loveable/src/components/dialogs/EmailNotificationDialog.tsx; BE: backend/src/routes/emailNotificationRoutes.ts, backend/src/worker/summarizeWorker.ts');
  } else if (/showed no summaries|refresh the page|didn’t get an email/i.test(issue)) {
    set(row, 'Status', 'Fixed (code)');
    set(row, 'Comment', 'Summaries page polls and forces immediate refetch after job creation; email as above.');
    set(row, 'Evidence', 'FE: loveable/src/pages/Summaries.tsx (refetch, refetchInterval, processing notice)');
  } else if (/download.*Word|download failed/i.test(issue)) {
    set(row, 'Status', 'Fixed (code)');
    set(row, 'Comment', 'Download route builds DOCX/TXT/PDF from parsed markdown; frontend uses jobId+format. Validate with a completed job.');
    set(row, 'Evidence', 'FE: loveable/src/pages/DownloadSummary.tsx; BE: backend/src/routes/downloadRoutes.ts (DOCX/PDF branches)');
  } else if (/Back.*preview/i.test(issue) || /Back icon/i.test(issue)) {
    set(row, 'Status', 'Fixed (code)');
    set(row, 'Comment', 'Preview modal Back now navigates to prior page or /summaries; title uses uploaded file title.');
    set(row, 'Evidence', 'FE: loveable/src/pages/SummaryPreview.tsx (close handler)');
  } else if (/remove "#?Case Metadata"|civil action number|Deposition Title is "Unknown"|Date.*wrong|Page Numbers.*spaced/i.test(issue)) {
    set(row, 'Status', 'Partially addressed');
    set(row, 'Comment', 'Exports strip Case Metadata headings; metadata extraction favors first lines; page table rendering improved. Needs validation on Emhart sample.');
    set(row, 'Evidence', 'BE: backend/src/routes/downloadRoutes.ts (parseMarkdown filter); BE worker metadata/date extraction; CSS/formatting in preview');
  } else if (/pages.*summarized.*should list/i.test(issue) || /page numbers.*jump/i.test(issue)) {
    set(row, 'Status', 'Addressed (needs validation)');
    set(row, 'Comment', 'Improved page detection and de-duplication; reduced chunk size for continuity. Reprocess Emhart to confirm.');
    set(row, 'Evidence', 'BE: backend/src/worker/summarizeWorker.ts (splitPages, chunk size)');
  } else if (/Emhart.*transcript.*uploaded/i.test(issue)) {
    set(row, 'Status', 'Info only');
    set(row, 'Comment', 'Reference to source file; no action needed.');
    set(row, 'Evidence', '—');
  } else if (/Old Instructions/i.test(issue)) {
    set(row, 'Status', 'Updated');
    set(row, 'Comment', 'New instructions incorporated into summarization prompt and exporters.');
    set(row, 'Evidence', 'BE: worker prompt + exporters');
  } else if (/Detailed Testimony Table/i.test(issue)) {
    set(row, 'Status', 'Incorporated');
    set(row, 'Comment', 'Worker prompt enforces page-line, two-column table with legal accuracy.');
    set(row, 'Evidence', 'BE: backend/src/worker/summarizeWorker.ts (makePrompt)');
  } else {
    set(row, 'Status', row['Status'] || 'Reviewed');
    set(row, 'Comment', row['Comment'] || 'No change');
    set(row, 'Evidence', row['Evidence'] || '—');
  }
  set(row, 'Last Updated', now);
}

const newWs = xlsx.utils.json_to_sheet(rows);
wb.Sheets[sheetName] = newWs;

const backup = inPath.replace(/\.xlsx$/i, `.backup.${now.replace(/[:]/g,'-')}.xlsx`);
fs.copyFileSync(inPath, backup);
xlsx.writeFile(wb, inPath);

console.log(`Updated: ${inPath}`);
console.log(`Backup: ${backup}`);

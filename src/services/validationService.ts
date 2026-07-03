import fs from "fs";
import path from "path";

export interface BuildValidationOpts {
  generatedMeta: string[];
  generatedRows: Array<[string, string, string]>; // [page, topic, summary]
  referenceText?: string;
}

const LOG_DIR = path.resolve(process.cwd(), "summaries/validation_logs");
export { LOG_DIR };

export function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowHHMM(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}-${mm}`;
}

export function buildValidationTable(opts: BuildValidationOpts): string {
  const { generatedMeta, generatedRows, referenceText } = opts;

  const lines: string[] = [];
  lines.push("# Validation: Generated vs. Reference");
  lines.push("");
  if (generatedMeta?.length) {
    lines.push("## Summary Overview (Generated)");
    lines.push(...generatedMeta.map((m) => `- ${m}`));
    lines.push("");
  }
  lines.push("| Generated Summary | Reference Summary |");
  lines.push("|---|---|");

  const refExcerpt =
    referenceText?.replace(/\s+/g, " ").trim().slice(0, 300) ||
    "Reference excerpt unavailable in v1.";

  for (const [page, topic, summary] of generatedRows) {
    const topicPrefix = topic ? `[${topic}] ` : "";
    const left = `**${page}** — ${topicPrefix}${summary}`.replace(/\n/g, " ");
    lines.push(`| ${left} | ${refExcerpt} |`);
  }

  lines.push("");
  lines.push(
    "_Note: This table aligns by generated sections/rows; reference side is an excerpt placeholder in v1._"
  );
  return lines.join("\n");
}

export function saveValidationLog(summaryName: string, markdown: string): { filePath: string; filename: string } {
  ensureLogDir();
  const safe = summaryName.replace(/[^a-z0-9_.-]+/gi, "-");
  const filename = `${safe}_${nowHHMM()}_validation.md`;
  const filePath = path.join(LOG_DIR, filename);
  fs.writeFileSync(filePath, markdown, "utf-8");
  return { filePath, filename };
}

export function pruneValidationLogs(summaryName: string, keep: number = 3): string[] {
  ensureLogDir();
  const safe = summaryName.replace(/[^a-z0-9_.-]+/gi, "-");
  const prefix = `${safe}_`;
  const suffix = `_validation.md`;

  const files = fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => ({ f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = files.slice(keep).map((x) => x.f);
  toDelete.forEach((f) => fs.unlinkSync(path.join(LOG_DIR, f)));
  return toDelete;
}


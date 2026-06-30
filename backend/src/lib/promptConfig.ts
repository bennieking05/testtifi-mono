import fs from "fs";
import path from "path";

export interface SummaryPromptConfig {
  system: string;
  temperature: number;
  maxTokens: number;
}

const defaultConfig: SummaryPromptConfig = {
  system: "You are a legal assistant tasked with summarizing a deposition transcript. Produce a structured page-line summary for law firms.\n\n**TABLE FORMAT:**\n- For SINGLE deponent transcripts, use EXACTLY 2 columns: | Page/Line | Summary |\n- For MULTIPLE deponent transcripts, use EXACTLY 3 columns: | Page/Line | Witness | Summary |\n- Do NOT use a Topic column.\n\n**PAGE/LINE COLUMN:**\n- Prefer page ranges without line numbers when the row covers entire transcript pages: use `p.X` or `p.X-Y` (e.g. `p.12`, `p.12-16`).\n- Include line numbers ONLY when the summary covers a partial page (not the full page). Format: `p.X:StartLine-EndLine` or `p.X-Y:StartLine-EndLine` when line numbers are visible in the transcript.\n- If line numbers are not visible, omit them; use page ranges only.\n- Use the real transcript page numbers from headers/corners, NOT PDF scan page numbers.\n\n**WITNESS COLUMN (multi-deponent only):**\n- Include the Witness column ONLY when the transcript contains more than one deponent.\n- For single-deponent depositions, omit the Witness column entirely.\n\n**SUMMARY COLUMN:**\n- Narrative prose, third-person past tense.\n- Include WHO, WHAT, WHEN, specifics (figures, exhibits), objections briefly.\n- Group testimony into consistent blocks of ~5 (up to 6) consecutive transcript pages per row (e.g. `p.12-17`, `p.18-23`). Do NOT emit 1-2 page or single-page rows; keep the page/line designations consistent throughout the summary.\n- Keep each summary concise but complete; never omit substantive testimony to save space.\n\n**WITNESS REFERENCE:**\n- Refer to the deponent by last name only (e.g. \"Smith testified...\", \"Smith confirmed...\").\n- NEVER use gendered pronouns for the deponent (he/she/his/her/him), and never alternate between \"he\" and \"she\" for the witness anywhere in the summary. Repeat the last name or use \"the witness\" instead.\n- This rule applies only to the deponent; other people named in the testimony may be referred to normally.\n\n**AVOID:**\n- Q: and A: format\n- Topic labels or an extra Topic column\n- Mentioning OCR, scanned text, text extraction, or page header markers (e.g. === PAGE X ===)\n- Commentary, opinions, apologies, or prompts to continue\n\n**NON-SUBSTANTIVE PAGES:**\n- If a page or page range has no substantive testimony (caption, certification, blank, unreadable OCR, or administrative filler only), output exactly __SKIP__ as the entire Summary cell for that row (e.g. | p.5 | __SKIP__ |). Use the literal token __SKIP__ with no other words.\n- Do not state that content was illegible, minimal, empty, non-substantive, or procedural.\n\n**OUTPUT:** Markdown table rows only (no header row).",
  temperature: 0.0,
  maxTokens: 4000,
};

const CONFIG_PATH =
  process.env.SUMMARY_PROMPT_PATH ||
  path.resolve(process.cwd(), "config/summaryPrompt.json");

function ensureDirExists(p: string) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadPromptConfig(): SummaryPromptConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      ensureDirExists(CONFIG_PATH);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      system: typeof parsed.system === "string" ? parsed.system : defaultConfig.system,
      temperature:
        typeof parsed.temperature === "number"
          ? parsed.temperature
          : defaultConfig.temperature,
      maxTokens:
        typeof parsed.maxTokens === "number" ? parsed.maxTokens : defaultConfig.maxTokens,
    };
  } catch (e) {
    console.warn("Failed to load prompt config, using defaults:", e);
    return defaultConfig;
  }
}

export function savePromptConfig(cfg: SummaryPromptConfig): SummaryPromptConfig {
  const sanitized: SummaryPromptConfig = {
    system: String(cfg.system ?? defaultConfig.system),
    temperature: Number.isFinite(cfg.temperature) ? cfg.temperature : defaultConfig.temperature,
    maxTokens: Number.isFinite(cfg.maxTokens) ? cfg.maxTokens : defaultConfig.maxTokens,
  };
  ensureDirExists(CONFIG_PATH);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(sanitized, null, 2));
  return sanitized;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

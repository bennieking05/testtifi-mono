import fs from "fs";
import path from "path";

export interface SummaryPromptConfig {
  system: string;
  temperature: number;
  maxTokens: number;
}

const defaultConfig: SummaryPromptConfig = {
  system:
    `You are a senior litigation paralegal producing PAGE‑LINE deposition summaries for law firms. Output MUST be Markdown table rows ONLY.

COLUMN FORMAT (CRITICAL):
- For SINGLE-WITNESS transcripts: 3 columns — | Page/Line | Topic | Summary |
- For MULTI-WITNESS transcripts: 4 columns — | Page/Line | Witness | Topic | Summary |

TOPIC GROUPING (CRITICAL):
- Group testimony by TOPIC, covering up to 5 consecutive pages per row when the topic is the same.
- Start a NEW ROW when the topic changes, even within the same page range.
- DO NOT create one row per page — group related testimony together by topic.

TOPIC LABELS:
- Each row MUST have a concise topic label (2-5 words).
- Examples: "Compensation Structure", "Employment History", "Sales Territories", "Commission Disputes", "Document Review", "Exhibit Discussion", "Product Description".
- Use consistent topic labels when the same subject continues.
- "Educational background" / "Education": ONLY the witness's formal schooling, degrees, licenses, and training—not educational products, curricula, or instructional materials (use "Product Description" or "Document Review" for those).

PAGE/LINE FORMAT:
- Format as page ranges: "p.X-Y" for multiple pages, "p.X:L1-L2" for specific lines.
- Group up to 5 pages per row when discussing the same topic.

SUMMARY CONTENT:
- Write in narrative prose, third-person past tense (e.g., "testified", "stated", "confirmed").
- Include: WHO (names, titles), WHAT (actions, statements), WHEN (dates), specifics (figures, exhibits).
- Note objections, rulings, and procedural matters briefly.
- 3-6 complete sentences per row for substantive testimony.

COMPRESSION: Target ~5:1 ratio (five transcript pages per one page of summary).

AVOID:
- One row per page (group by topic instead)
- Q: and A: format (use narrative prose)
- Vague topic labels
- Commentary, apologies, or prompts to continue
- Header rows (output data rows only)
- Mentioning OCR, scanned text, text extraction, or page header markers (e.g. === PAGE X ===) in the Summary column`,
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
  // #region agent log H1
  console.log('[DEBUG-H1] loadPromptConfig called, CONFIG_PATH:', CONFIG_PATH);
  // #endregion
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      // #region agent log H1
      console.log('[DEBUG-H1] Config file does not exist, using TypeScript default');
      console.log('[DEBUG-H1] Default prompt starts with:', defaultConfig.system.substring(0, 100));
      // #endregion
      ensureDirExists(CONFIG_PATH);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    // #region agent log H1
    console.log('[DEBUG-H1] Loaded config from JSON file, first 100 chars:', raw.substring(0, 100));
    // #endregion
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

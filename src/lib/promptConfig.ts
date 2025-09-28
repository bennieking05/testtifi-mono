import fs from "fs";
import path from "path";

export interface SummaryPromptConfig {
  system: string;
  temperature: number;
  maxTokens: number;
}

const defaultConfig: SummaryPromptConfig = {
  system:
    "You are a senior litigation paralegal producing PAGE‑LINE deposition summaries for law firms. Output MUST be Markdown with: (1) a legal‑style metadata block (first chunk only) and (2) ONLY a page‑line table.\n\nStrict requirements:\n- Style: professional, neutral, precise.\n- Focus: attorney questions (Q:) and witness answers (A:); include objections, rulings, instructions not to answer.\n- Detail: include exhibit IDs and short descriptions; dates, figures, names, positions; short quotes (≤ 20 words) where probative.\n- Compression: target ~5:1 (five transcript pages per one page of summary).\n- Segmentation: produce multiple rows per page when topics change (fine‑grained).\n- Columns: EXACTLY two — (1) Page/Line and (2) Testimony.\n- Lines: when visible, show ranges like “p.147:1‑15”; else “p.147–148”.\n- No header row; rows only.\n- No commentary, apologies, or prompts to continue.",
  temperature: 0.0,
  maxTokens: 3800,
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




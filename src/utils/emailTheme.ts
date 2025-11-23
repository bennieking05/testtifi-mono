export type EmailTheme = "light" | "dark" | "auto";

export type ThemeTokens = {
  bg: string;
  text: string;
  muted: string;
  panel: string;
  border: string;
  brand: string;
  btnText: string;
  noticeBg: string;
  noticeText: string;
  noticeBorder: string;
};

export function getThemeTokens(theme: EmailTheme): {
  light: ThemeTokens;
  dark: ThemeTokens;
  selected: ThemeTokens;
} {
  const light: ThemeTokens = {
    bg: "#ffffff",
    text: "#111111",
    muted: "#475569",
    panel: "#ffffff",
    border: "#e0e0e0",
    brand: "#5674BC",
    btnText: "#ffffff",
    noticeBg: "#fff3cd",
    noticeText: "#856404",
    noticeBorder: "#ffc107",
  };
  const dark: ThemeTokens = {
    bg: "#0b1220",
    text: "#e2e8f0",
    muted: "#94a3b8",
    panel: "#0f172a",
    border: "#334155",
    brand: "#5674BC",
    btnText: "#ffffff",
    noticeBg: "#1f2937",
    noticeText: "#fde68a",
    noticeBorder: "#facc15",
  };
  const selected = theme === "dark" ? dark : light;
  return { light, dark, selected };
}

export function renderEmailShell(params: {
  title: string;
  bodyHtml: string;
  theme?: EmailTheme;
  logoCid: string;
}): string {
  const theme: EmailTheme = params.theme || "auto";
  const { dark, selected } = getThemeTokens(theme);
  const colorSchemeMeta =
    theme === "auto"
      ? `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">`
      : "";
  const autoCss =
    theme === "auto"
      ? `
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: ${dark.bg};
        --text: ${dark.text};
        --muted: ${dark.muted};
        --panel: ${dark.panel};
        --border: ${dark.border};
        --brand: ${dark.brand};
        --btnText: ${dark.btnText};
        --noticeBg: ${dark.noticeBg};
        --noticeText: ${dark.noticeText};
        --noticeBorder: ${dark.noticeBorder};
      }
    }
  `
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(params.title)}</title>
  ${colorSchemeMeta}
  <style>
    :root {
      --bg: ${selected.bg};
      --text: ${selected.text};
      --muted: ${selected.muted};
      --panel: ${selected.panel};
      --border: ${selected.border};
      --brand: ${selected.brand};
      --btnText: ${selected.btnText};
      --noticeBg: ${selected.noticeBg};
      --noticeText: ${selected.noticeText};
      --noticeBorder: ${selected.noticeBorder};
    }
    ${autoCss}
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: var(--text);
      margin: 0;
      padding: 0;
      background-color: var(--bg);
    }
    a { color: var(--brand); text-decoration: underline; }
    .wrapper {
      max-width: 600px;
      margin: 0 auto;
      background-color: var(--panel);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background-color: var(--brand);
      padding: 24px 16px;
      text-align: center;
    }
    .header img {
      max-width: 200px;
      height: auto;
      display: block;
      margin: 0 auto;
    }
    .content { padding: 32px 24px; }
    .content h2 { color: var(--text); margin: 0 0 20px 0; font-size: 24px; }
    .content p { margin: 16px 0; color: var(--muted); }
    .cta-wrap { text-align: center; margin: 28px 0; }
    .btn {
      display: inline-block; padding: 12px 24px;
      background-color: var(--brand); color: var(--btnText) !important;
      text-decoration: none; border-radius: 6px; font-weight: 600;
    }
    .btn:hover { filter: brightness(0.95); color: var(--btnText) !important; }
    .receipt-details {
      background-color: rgba(0,0,0,0.02);
      border-radius: 6px; padding: 20px; margin: 24px 0;
    }
    .receipt-row {
      display: flex; justify-content: space-between; padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }
    .receipt-row:last-child {
      border-bottom: none; font-weight: bold; font-size: 18px;
      padding-top: 12px; margin-top: 8px; border-top: 2px solid var(--brand);
    }
    .receipt-label { color: var(--muted); }
    .receipt-value { color: var(--text); font-weight: 500; }
    .payment-id { font-size: 12px; color: var(--muted); margin-top: 12px; }
    .notice {
      margin-top: 24px; padding: 16px; background-color: var(--noticeBg);
      border-left: 4px solid var(--noticeBorder); border-radius: 4px; color: var(--noticeText);
    }
    .footer {
      background-color: rgba(0,0,0,0.03);
      color: var(--muted);
      font-size: 13px; text-align: center; padding: 24px 16px; border-top: 1px solid var(--border);
    }
    .footer p { margin: 4px 0; line-height: 1.5; }
    @media (max-width: 600px) {
      .wrapper { border-radius: 0; }
      .content { padding: 24px 16px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <img src="cid:${escapeHtml(params.logoCid)}" alt="Testifi AI" />
    </div>
    <div class="content">
      ${params.bodyHtml}
    </div>
    <div class="footer">
      <p><strong>© ${new Date().getFullYear()} Testifi AI. All rights reserved.</strong></p>
      <p>You're receiving this because you have an account on Testifi AI.</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}



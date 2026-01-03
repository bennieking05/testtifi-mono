/*
  One-off dev script: send a test email with inline CID logo via SendGrid.
  Usage (from repo root):
    DOTENV_CONFIG_PATH=backend/.env TEST_EMAIL_TO=to@example.com \
      npx --prefix backend ts-node -P backend/tsconfig.json scripts/test-send-inline-logo.ts
*/
import fs from "fs";
import path from "path";
// Minimal .env loader (avoid requiring dotenv from root)
const dotenvPath = process.env.DOTENV_CONFIG_PATH || "backend/.env";
try {
  const abs = path.resolve(dotenvPath);
  if (fs.existsSync(abs)) {
    const text = fs.readFileSync(abs, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      // Strip surrounding quotes if present
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    console.log(`Loaded env from ${abs}`);
  } else {
    console.warn(`Env file not found at ${abs}, relying on process env`);
  }
} catch (e) {
  console.warn("Failed to load env file:", e);
}
import { sendEmail, EmailAttachment } from "../backend/src/lib/sendEmail";
import { loadLightLogo } from "../backend/src/utils/logo";
import { renderEmailShell } from "../backend/src/utils/emailTheme";

async function main() {
  const to = process.env.TEST_EMAIL_TO || "";
  const from = process.env.EMAIL_USER || "";
  const api = process.env.SENDGRID_API_KEY || "";

  if (!to || !from || !api) {
    console.error(
      "Missing required env. Set EMAIL_USER, SENDGRID_API_KEY, and TEST_EMAIL_TO before running."
    );
    process.exit(1);
  }

  const logo = loadLightLogo();
  const cid = "logo@testifi.ai";
  const inlineLogo: EmailAttachment = {
    content: logo.base64,
    filename: "logo.png",
    type: logo.mime,
    disposition: "inline",
    contentId: cid,
  };

  const bodyHtml = `
    <h2>Inline Logo Test</h2>
    <p>If you can see the Testifi logo above, inline CID images are working.</p>
  `;
  const htmlLight = renderEmailShell({
    title: "Inline Logo Test (Light)",
    bodyHtml,
    theme: "light",
    logoCid: cid,
  });
  const htmlDark = renderEmailShell({
    title: "Inline Logo Test (Dark)",
    bodyHtml,
    theme: "dark",
    logoCid: cid,
  });

  const text = "Inline Logo Test: If you can see the Testifi logo in the HTML email, CID is working.";

  await sendEmail(to, "Testifi Inline Logo Test (Light)", text, htmlLight, [inlineLogo]);
  await sendEmail(to, "Testifi Inline Logo Test (Dark)", text, htmlDark, [inlineLogo]);
  console.log("✓ Test emails sent. Check your inbox for both light and dark variants.");
}

main().catch((err) => {
  console.error("Failed to send test email:", err);
  process.exit(1);
});



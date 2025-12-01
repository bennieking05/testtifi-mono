import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PROD_URL = "https://app.testifi.ai";
const DEFAULT_STAGING_URL = "https://staging.app.testifi.ai";
const DEFAULT_DEV_URL = "http://localhost:3000";

export function resolveFrontendBaseUrl(): string {
  const raw =
    process.env.BASE_URL ??
    process.env.FRONTEND_URL ??
    process.env.APP_URL;

  const trimmed = raw?.trim();
  const isBad =
    !trimmed ||
    /^(undefined|null)$/i.test(trimmed);

  if (!isBad && trimmed) {
    return trimmed.replace(/\/+$/, "");
  }

  if (process.env.STAGING === "1" || process.env.ENVIRONMENT === "staging") {
    return DEFAULT_STAGING_URL;
  }

  if (process.env.NODE_ENV === "production") {
    return DEFAULT_PROD_URL;
  }

  return DEFAULT_DEV_URL;
}



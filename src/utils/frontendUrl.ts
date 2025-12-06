import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PROD_URL = "https://app.testifi.ai";
const DEFAULT_STAGING_URL = "https://staging.app.testifi.ai";
const DEFAULT_DEV_URL = "http://localhost:3000";

function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^(1|true)$/i.test(value.trim());
}

function envIs(target: string): boolean {
  const normalized = target.trim().toLowerCase();
  const buckets = [
    process.env.STAGING && isTruthy(process.env.STAGING) ? "staging" : null,
    process.env.ENVIRONMENT,
    process.env.APP_ENV,
    process.env.NODE_ENV,
  ]
    .filter(Boolean)
    .map((v) => v!.trim().toLowerCase());
  return buckets.includes(normalized);
}

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

  if (envIs("staging")) {
    return DEFAULT_STAGING_URL;
  }

  if (envIs("production")) {
    return DEFAULT_PROD_URL;
  }

  return DEFAULT_DEV_URL;
}





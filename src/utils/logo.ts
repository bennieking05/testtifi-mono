import fs from "fs";
import path from "path";

type Nullable<T> = T | null;

export interface LogoAsset {
  buf: Buffer;
  base64: string;
  mime: string;
  width?: number;
  height?: number;
  source: string;
}

const FALLBACK_BASE64 =
  "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" +
  "CAmswQAAAABJRU5ErkJggg=="
;

const FALLBACK_WIDTH = 282;
const FALLBACK_HEIGHT = 91;

const FALLBACK_LOGO: LogoAsset = {
  buf: Buffer.from(FALLBACK_BASE64, "base64"),
  base64: FALLBACK_BASE64,
  mime: "image/png",
  width: FALLBACK_WIDTH,
  height: FALLBACK_HEIGHT,
  source: "embedded fallback",
};

let cachedLogo: Nullable<LogoAsset> | undefined;

function computeDimensions(buf: Buffer): { width?: number; height?: number; mime: string } {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      mime: "image/png",
    };
  }
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    return { mime: "image/jpeg" };
  }
  return { mime: "application/octet-stream" };
}

function resolveCandidatePaths(): string[] {
  const cwd = process.cwd();
  const candidates: Array<string | undefined> = [
    process.env.LIGHT_LOGO_PATH,
    process.env.LOGO_PATH,
    path.resolve(cwd, "og-image.png"),
    path.resolve(cwd, "backend/og-image.png"),
    path.resolve(cwd, "assets/og-image.png"),
    path.resolve(cwd, "loveable/public/testifi_light_logo.png"),
    path.resolve(cwd, "loveable/public/testifi_dark_logo.png"),
    path.resolve(cwd, "public/testifi_light_logo.png"),
    path.resolve(cwd, "public/testifi_dark_logo.png"),
    path.resolve(__dirname, "../og-image.png"),
    path.resolve(__dirname, "../../og-image.png"),
    path.resolve(__dirname, "../../../og-image.png"),
  ];
  return Array.from(new Set(candidates.filter(Boolean))) as string[];
}

function readLogoFromDisk(): Nullable<LogoAsset> {
  for (const candidate of resolveCandidatePaths()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const buf = fs.readFileSync(candidate);
      const { width, height, mime } = computeDimensions(buf);
      const base64 = buf.toString("base64");
      const asset: LogoAsset = { buf, base64, mime, width, height, source: candidate };
      console.log(`✓ Logo loaded successfully from: ${candidate}`);
      return asset;
    } catch (err) {
      console.warn(`✗ Failed to load logo from: ${candidate}`, err);
    }
  }
  return null;
}

export function loadLogo(): LogoAsset {
  if (cachedLogo) return cachedLogo;
  if (cachedLogo === null) return FALLBACK_LOGO;

  const resolved = readLogoFromDisk();
  if (resolved) {
    cachedLogo = resolved;
    return resolved;
  }

  console.warn("⚠ No logo asset found on disk. Using embedded fallback logo.");
  cachedLogo = FALLBACK_LOGO;
  return FALLBACK_LOGO;
}

export function getLogoDataUri(): string {
  const logo = loadLogo();
  return `data:${logo.mime};base64,${logo.base64}`;
}

import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

const ALLOWED_FILES = new Set([
  "testifi_dark_logo.png",
  "testifi_light_logo.png",
  "testifi_dark_icon.png",
  "testifi_light_icon.png",
]);

function findAssetOnDisk(filename: string): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "public", filename),
    path.resolve(cwd, "backend", "public", filename),
    path.resolve(cwd, "loveable", "public", filename),
    path.resolve(__dirname, "../public", filename),
    path.resolve(__dirname, "../../public", filename),
    path.resolve(__dirname, "../../../loveable/public", filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

router.get("/:filename", (req, res) => {
  const filename = path.basename(req.params.filename || "");
  if (!ALLOWED_FILES.has(filename)) {
    res.status(404).send("Not found");
    return;
  }
  const full = findAssetOnDisk(filename);
  if (!full) {
    res.status(404).send("Not found");
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.type(path.extname(filename)); // sets content-type e.g. .png
  res.sendFile(full);
});

export default router;



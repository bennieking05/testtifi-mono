import express, { Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const router = express.Router();

const ART_DIR = path.resolve(process.cwd(), "artifacts", "snaps-client");
fs.mkdirSync(ART_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    const ts = Date.now();
    const name = req.file.originalname || "snapshot.png";
    const outPath = path.join(ART_DIR, `${ts}_${name}`);
    fs.writeFileSync(outPath, req.file.buffer);
    res.json({ ok: true, path: outPath });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

router.post("/meta", async (req: Request, res: Response) => {
  try {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    await new Promise<void>((resolve) => req.on("end", () => resolve()));
    const body = Buffer.concat(chunks).toString("utf-8");
    const metaLog = path.join(ART_DIR, "meta.log");
    const line = `${Date.now()} ${body || "{}"}\n`;
    fs.appendFileSync(metaLog, line);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

export default router;


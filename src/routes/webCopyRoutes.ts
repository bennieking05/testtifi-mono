import express, { Request, Response } from "express";
import fs from "fs";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = express.Router();

/**
 * POST /api/webcopy
 * Body: { route: string; lines: string[] }
 * Appends the visible text lines for a given route to a markdown file.
 */
router.post(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { route, lines } = req.body as { route?: string; lines?: string[] };
      if (!route || !Array.isArray(lines)) {
        res.status(400).json({ error: "route and lines[] are required" });
        return;
      }

      const targetPath =
        process.env.WEB_COPY_PATH ||
        "/Users/bennieking/Sites/testifiAi/webCopy.md";

      const header = `\n\n## ${route} — ${new Date().toISOString()}\n`;
      const body = lines.map((l) => `- ${l}`).join("\n");
      fs.appendFileSync(targetPath, header + body + "\n");

      res.json({ ok: true, path: targetPath, lines: lines.length });
    } catch (err) {
      console.error("[/api/webcopy] Error:", err);
      res.status(500).json({ error: "Failed to write web copy" });
    }
  }
);

export default router;



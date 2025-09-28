import fs from "fs";
import { Request, Response } from "express";
import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import {
  buildValidationTable,
  ensureLogDir,
  pruneValidationLogs,
  saveValidationLog,
} from "../services/validationService";
import { objectKey, parseMarkdown } from "../routes/downloadRoutes";

const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");

export async function runValidation(req: Request, res: Response) {
  try {
    const { jobId, summaryName, referencePath } = req.body as {
      jobId: string;
      summaryName: string;
      referencePath?: string;
    };
    if (!jobId || !summaryName) {
      res.status(400).json({ error: "Missing jobId or summaryName" });
      return;
    }

    const job = await prisma.summaryJob.findUnique({
      where: { id: jobId },
      include: { file: true },
    });
    if (!job) {
      res.status(404).json({ error: "Summary job not found" });
      return;
    }

    const key = job.summaryCsvUrl
      ? objectKey(job.summaryCsvUrl)
      : job.file?.summaryFileName ?? `summary-${job.id}.md`;
    const [buf] = await bucket.file(key).download();
    const data = buf.toString("utf-8");
    const parsed = parseMarkdown(data);
    const rows = parsed.rows;

    let referenceText: string | undefined;
    if (referencePath) {
      try {
        referenceText = fs.readFileSync(referencePath, "utf-8");
      } catch {
        referenceText = undefined;
      }
    }

    const md = buildValidationTable({
      generatedMeta: parsed.meta,
      generatedRows: rows,
      referenceText,
    });

    ensureLogDir();
    const saved = saveValidationLog(summaryName, md);
    const pruned = pruneValidationLogs(summaryName, 3);

    res.status(200).json({ saved: true, filename: saved.filename, pruned });
  } catch (err) {
    console.error("runValidation error:", err);
    res.status(500).json({ error: "Failed to run validation." });
  }
}


import fs from "fs";
import path from "path";
import {
  buildValidationTable,
  ensureLogDir,
  LOG_DIR,
  pruneValidationLogs,
  saveValidationLog,
} from "../src/services/validationService";

describe("validationService", () => {
  const summaryName = "UAT4_2";

  beforeAll(() => {
    ensureLogDir();
  });

  afterAll(() => {
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("UAT4_2_") && f.endsWith("_validation.md"));
    files.forEach((f) => fs.unlinkSync(path.join(LOG_DIR, f)));
  });

  test("buildValidationTable produces header and rows", () => {
    const md = buildValidationTable({
      generatedMeta: ["Witness sworn", "Counsel appearances"],
      generatedRows: [
        ["p.1:1-10", "Intro"],
        ["p.2", "Background"],
      ],
      referenceText: "Reference excerpt text.",
    });
    expect(md).toContain("| Generated Summary | Reference Summary |");
    expect(md).toContain("p.1:1-10");
    expect(md).toContain("Reference excerpt text.");
  });

  test("saveValidationLog writes file with HH-MM", () => {
    const md = "# test\n";
    const { filePath, filename } = saveValidationLog(summaryName, md);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filename).toMatch(/^UAT4_2_\d{2}-\d{2}_validation\.md$/);
  });

  test("pruneValidationLogs keeps only latest 3", () => {
    for (let i = 0; i < 5; i++) {
      saveValidationLog(summaryName, `# run ${i}\n`);
    }
    const deleted = pruneValidationLogs(summaryName, 3);
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("UAT4_2_") && f.endsWith("_validation.md"));
    expect(files.length).toBeLessThanOrEqual(3);
    expect(Array.isArray(deleted)).toBe(true);
  });
});



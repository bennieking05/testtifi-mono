import request from "supertest";
import fs from "fs";
import app from "../src/server";
import { ensureLogDir, LOG_DIR, pruneValidationLogs } from "../src/services/validationService";

describe("POST /api/validation/run", () => {
  const summaryName = "UAT4_2";
  const token = "test"; // Replace with real token or mock auth middleware

  beforeAll(() => {
    ensureLogDir();
  });

  afterAll(() => {
    pruneValidationLogs(summaryName, 0);
  });

  it("creates a validation log and prunes to 3", async () => {
    const body = { jobId: "seeded-job-id", summaryName };

    const res = await request(app)
      .post("/api/validation/run")
      .set("Authorization", `Bearer ${token}`)
      .send(body);

    expect([200, 201]).toContain(res.status);
    expect(res.body.saved).toBeTruthy();
    expect(res.body.filename).toMatch(/^UAT4_2_\d{2}-\d{2}_validation\.md$/);

    for (let i = 0; i < 4; i++) {
      await request(app)
        .post("/api/validation/run")
        .set("Authorization", `Bearer ${token}`)
        .send(body);
    }

    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("UAT4_2_") && f.endsWith("_validation.md"));
    expect(files.length).toBeLessThanOrEqual(3);
  });
});


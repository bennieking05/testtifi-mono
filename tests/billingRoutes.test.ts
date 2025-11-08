import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import app from "../src/server";
import {
  __setPrismaClientForTests,
  __resetPrismaClientForTests,
} from "../src/routes/billingRoutes";

describe("billing routes", () => {
  const prismaMock = {
    ledgerEntry: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  } as unknown as PrismaClient;

  beforeAll(() => {
    __setPrismaClientForTests(prismaMock);
  });

  afterAll(() => {
    __resetPrismaClientForTests();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns balance", async () => {
    (prismaMock.ledgerEntry.aggregate as jest.Mock).mockResolvedValue({ _sum: { credits: 15 } });

    const res = await request(app)
      .get("/api/billing/balance")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(15);
  });
});


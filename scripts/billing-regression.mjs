#!/usr/bin/env node
/**
 * Billing / Stripe credit regression — runs against built backend/dist (no jest, no DB).
 * Covers the money-safety invariants:
 *   - webhook credit-grant idempotency (duplicate payment_intent.succeeded -> one credit)
 *   - refund proportionality + idempotency + partial/full status
 *   - credit consumption (debit) correctness, FIFO allocation, debit idempotency
 *   - insufficient-credit failure
 *   - refund reverses a debit and is idempotent
 *
 * Run: npm run build && node scripts/billing-regression.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const requireFromRoot = createRequire(import.meta.url);

function loadBuiltModule(rel) {
  try {
    return requireFromRoot(path.join(root, rel));
  } catch (e) {
    if (e?.code === "MODULE_NOT_FOUND") {
      throw new Error(`Missing built module ${rel}. Run "npm run build" first.`);
    }
    throw e;
  }
}

process.env.STRIPE_API_KEY = process.env.STRIPE_API_KEY ?? "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_dummy";

const {
  determineRefundCredits,
  computeCreditsFromLineItems,
  recordPurchaseCredit,
  recordRefundLedger,
} = loadBuiltModule("backend/dist/routes/purchaseRoutes.js");

const {
  debitCreditsForSummary,
  refundCreditsForSummary,
  classifyLedgerEntry,
  buildHistoryTypeFilter,
  __setPrismaClientForTests,
  __resetPrismaClientForTests,
} = loadBuiltModule("backend/dist/routes/billingRoutes.js");

const { InsufficientCreditsError } = loadBuiltModule("backend/dist/billing/fifoAllocator.js");

// ── pure functions ──────────────────────────────────────────────────────────
function testDetermineRefundCredits() {
  assert.equal(determineRefundCredits(10, 10_000, 5_000), 5, "proportional partial refund");
  assert.equal(determineRefundCredits(8, 10_000, 12_000), 8, "refund >= purchase -> all credits");
  assert.equal(determineRefundCredits(2, 10_000, 1), 2, "tiny positive refund never returns 0");
}

function testComputeCreditsFromLineItems() {
  const items = [
    { quantity: 2, price: { product: { metadata: { credits: "3" } } } },
    { quantity: 1, price: { product: { metadata: { credits: "5" } } } },
  ];
  assert.equal(computeCreditsFromLineItems(items), 2 * 3 + 5);
  assert.equal(
    computeCreditsFromLineItems([{ quantity: 1, price: { product: { metadata: {} } } }]),
    0,
    "items without credits metadata contribute 0"
  );
}

// ── ledger display classification (UAT R48: expiry rows must not read "Credit −50") ──
function testClassifyLedgerEntry() {
  // Expiration: stored as credit + "expire:" idempotency key.
  assert.deepEqual(
    classifyLedgerEntry({ type: "credit", idempotencyKey: "expire:purchase_1" }),
    { displayType: "expired", expired: true, refund: false },
    "expiry rows classify as expired"
  );
  // Refund: stored as credit + "refund:" key.
  assert.deepEqual(
    classifyLedgerEntry({ type: "credit", idempotencyKey: "refund:sum_1" }),
    { displayType: "refund", expired: false, refund: true },
    "refund rows classify as refund"
  );
  // Genuine purchase credit.
  assert.deepEqual(
    classifyLedgerEntry({ type: "credit", idempotencyKey: "pi:pi_123" }),
    { displayType: "credit", expired: false, refund: false }
  );
  // Debit is untouched even without a key.
  assert.deepEqual(
    classifyLedgerEntry({ type: "debit", idempotencyKey: null }),
    { displayType: "debit", expired: false, refund: false }
  );
  // Prefixes only reclassify credit rows.
  assert.equal(
    classifyLedgerEntry({ type: "debit", idempotencyKey: "expire:x" }).displayType,
    "debit",
    "expire prefix on a non-credit row does not reclassify"
  );
}

function testBuildHistoryTypeFilter() {
  assert.deepEqual(
    buildHistoryTypeFilter("expired"),
    { type: "credit", idempotencyKey: { startsWith: "expire:" } },
    "expired filter targets expire-prefixed credit rows"
  );
  assert.deepEqual(
    buildHistoryTypeFilter("refund"),
    { type: "credit", idempotencyKey: { startsWith: "refund:" } }
  );
  assert.deepEqual(
    buildHistoryTypeFilter("credit"),
    {
      type: "credit",
      NOT: [
        { idempotencyKey: { startsWith: "expire:" } },
        { idempotencyKey: { startsWith: "refund:" } },
      ],
    },
    "credit filter excludes expirations and refunds"
  );
  assert.deepEqual(buildHistoryTypeFilter("debit"), { type: "debit" });
  assert.deepEqual(buildHistoryTypeFilter(undefined), {}, "no filter -> all types");
}

// ── webhook credit-grant idempotency (recordPurchaseCredit) ───────────────────
function makeCreditTx(existingLedger = null) {
  const calls = { upsert: 0, create: 0 };
  const tx = {
    purchase: { upsert: async () => ((calls.upsert++), { id: "purchase_1" }) },
    ledgerEntry: {
      findUnique: async () => existingLedger,
      create: async () => ((calls.create++), { id: "ledger_1" }),
    },
  };
  return { tx, calls };
}

async function testWebhookCreditIdempotency() {
  const args = {
    paymentIntentId: "pi_test",
    userId: "user_1",
    credits: 10,
    amountCents: 12_500,
    currency: "usd",
    receiptUrl: "https://stripe.example/receipt",
  };

  // First delivery: creates a ledger credit.
  const first = makeCreditTx(null);
  await recordPurchaseCredit(first.tx, args);
  assert.equal(first.calls.create, 1, "first webhook delivery creates a credit");

  // Duplicate delivery (idempotency key already present): no second credit.
  const dup = makeCreditTx({ id: "existing" });
  await recordPurchaseCredit(dup.tx, args);
  assert.equal(dup.calls.create, 0, "duplicate payment_intent.succeeded does NOT double-credit");
}

// ── refund ledger (recordRefundLedger) ────────────────────────────────────────
function makeRefundTx({ aggregateSum = 0, existingLedger = null } = {}) {
  const purchaseRow = { id: "purchase_1", userId: "user_1", creditsAdded: 10, amountCents: 10_000 };
  const calls = { create: 0, update: [] };
  const tx = {
    purchase: {
      findUnique: async () => purchaseRow,
      update: async ({ data }) => ((calls.update.push(data.status)), { ...purchaseRow, ...data }),
    },
    ledgerEntry: {
      findUnique: async () => existingLedger,
      create: async ({ data }) => ((calls.create++, calls.lastCredits = data.credits), { id: "led" }),
      aggregate: async () => ({ _sum: { credits: aggregateSum } }),
    },
  };
  return { tx, calls };
}

async function testRefundLedger() {
  const args = { paymentIntentId: "pi_123", refundId: "refund:123", refundAmount: 5_000, reason: "Refund test" };

  // Partial refund -> negative ledger entry + partially_refunded status.
  const partial = makeRefundTx();
  await recordRefundLedger(partial.tx, args);
  assert.equal(partial.calls.create, 1);
  assert.equal(partial.calls.lastCredits, -5, "5000/10000 of 10 credits = -5");
  assert.deepEqual(partial.calls.update, ["partially_refunded"]);

  // Credits exhausted -> fully refunded status.
  const full = makeRefundTx({ aggregateSum: -5 });
  await recordRefundLedger(full.tx, args);
  assert.deepEqual(full.calls.update, ["refunded"]);

  // Idempotent: refund already recorded -> no-op.
  const dup = makeRefundTx({ existingLedger: { id: "already" } });
  await recordRefundLedger(dup.tx, args);
  assert.equal(dup.calls.create, 0, "duplicate refund event does not double-refund");
  assert.equal(dup.calls.update.length, 0);
}

// ── in-memory Prisma mock for the real debit/refund consumption path ──────────
function makeStore() {
  const ledger = [];
  const purchases = [];
  const allocations = [];
  let seq = 1;
  const id = (p) => `${p}_${seq++}`;

  const ledgerEntry = {
    findUnique: async ({ where }) => ledger.find((e) => e.idempotencyKey === where.idempotencyKey) || null,
    findMany: async () => [], // legacy-expiry path: nothing old enough
    create: async ({ data }) => {
      const e = { id: id("le"), ...data };
      ledger.push(e);
      return e;
    },
    aggregate: async ({ where = {} }) => {
      const rows = ledger.filter((e) => {
        if (where.userId && e.userId !== where.userId) return false;
        if (Object.prototype.hasOwnProperty.call(where, "purchaseId") && e.purchaseId !== where.purchaseId) return false;
        if (where.type && e.type !== where.type) return false;
        return true;
      });
      return { _sum: { credits: rows.reduce((s, e) => s + e.credits, 0) } };
    },
    count: async ({ where = {} }) => ledger.filter((e) => !where.userId || e.userId === where.userId).length,
  };

  const creditAllocation = {
    createMany: async ({ data }) => {
      for (const d of data) allocations.push({ id: id("ca"), ...d });
      return { count: data.length };
    },
    deleteMany: async ({ where }) => {
      let n = 0;
      for (let i = allocations.length - 1; i >= 0; i--) {
        if (allocations[i].debitLedgerId === where.debitLedgerId) {
          allocations.splice(i, 1);
          n++;
        }
      }
      return { count: n };
    },
    aggregate: async ({ where = {} }) => {
      const rows = allocations.filter((a) => where.purchaseId === undefined || a.purchaseId === where.purchaseId);
      return { _sum: { creditsUsed: rows.reduce((s, a) => s + a.creditsUsed, 0) } };
    },
  };

  const purchase = {
    findMany: async () => [], // expiry path: pretend no purchases are old enough
    findUnique: async ({ where }) => purchases.find((p) => p.id === where.id) || null,
    update: async ({ where, data }) => {
      const p = purchases.find((x) => x.id === where.id);
      Object.assign(p, data);
      return p;
    },
  };

  const user = { findUnique: async () => null, update: async () => ({}) };

  const store = {
    ledgerEntry,
    creditAllocation,
    purchase,
    user,
    $transaction: async (fn) => fn(store),
    // allocateCreditsFIFO calls $queryRaw(Prisma.sql`...`) with userId as the first value.
    $queryRaw: async (q) => {
      const userId = q?.values?.[0];
      return purchases
        .filter((p) => !userId || p.userId === userId)
        .map((p) => ({
          id: p.id,
          purchaseCreatedAt: p.createdAt,
          stripePaymentIntentId: p.stripePaymentIntentId,
          totalCredits: ledger
            .filter((e) => e.purchaseId === p.id && e.type === "credit")
            .reduce((s, e) => s + e.credits, 0),
          usedCredits: allocations
            .filter((a) => a.purchaseId === p.id)
            .reduce((s, a) => s + a.creditsUsed, 0),
        }));
    },
    seedPurchase(userId, credits) {
      const p = {
        id: id("p"),
        userId,
        createdAt: new Date(),
        stripePaymentIntentId: "pi_" + id("x"),
        creditsAdded: credits,
        amountCents: credits * 1000,
        status: "succeeded",
      };
      purchases.push(p);
      ledger.push({
        id: id("le"),
        userId,
        type: "credit",
        credits,
        purchaseId: p.id,
        idempotencyKey: "pi:" + p.stripePaymentIntentId,
      });
      return p;
    },
    balance(userId) {
      return ledger.filter((e) => e.userId === userId).reduce((s, e) => s + e.credits, 0);
    },
    countDebits(userId) {
      return ledger.filter((e) => e.userId === userId && e.type === "debit").length;
    },
  };
  return store;
}

async function testCreditConsumption() {
  const store = makeStore();
  __setPrismaClientForTests(store);
  try {
    store.seedPurchase("u1", 5);
    assert.equal(store.balance("u1"), 5, "seeded balance");

    // Debit one credit for a summary.
    const after = await debitCreditsForSummary("u1", "sumA");
    assert.equal(after, 4, "debit returns new balance");
    assert.equal(store.balance("u1"), 4);
    assert.equal(store.countDebits("u1"), 1, "exactly one debit recorded");

    // Idempotent debit: same summaryId must not double-charge.
    const again = await debitCreditsForSummary("u1", "sumA");
    assert.equal(again, 4, "repeat debit returns same balance");
    assert.equal(store.countDebits("u1"), 1, "repeat debit does NOT create a second debit");

    // Insufficient credits for a user with none.
    await assert.rejects(
      () => debitCreditsForSummary("u2", "sumB"),
      (err) => err instanceof InsufficientCreditsError,
      "user with no credits cannot debit"
    );

    // Refund reverses the debit and is idempotent.
    const refunded = await refundCreditsForSummary("u1", "sumA");
    assert.equal(refunded, 5, "refund restores balance");
    const refundedAgain = await refundCreditsForSummary("u1", "sumA");
    assert.equal(refundedAgain, 5, "duplicate refund does not over-credit");
  } finally {
    __resetPrismaClientForTests();
  }
}

const run = async () => {
  testDetermineRefundCredits();
  testComputeCreditsFromLineItems();
  testClassifyLedgerEntry();
  testBuildHistoryTypeFilter();
  await testWebhookCreditIdempotency();
  await testRefundLedger();
  await testCreditConsumption();
  console.log("Billing/credit regression checks passed.");
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

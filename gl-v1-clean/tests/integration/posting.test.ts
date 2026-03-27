import { knex } from "../../src/db/connection";
import { postTransaction } from "../../src/engine/posting";
import { DuplicateIdempotencyKeyError } from "../../src/engine/types";
import { setupTestTenant, cleanupTestTenant, closeKnex } from "./helpers";

beforeAll(async () => {
  await setupTestTenant();
});

afterEach(async () => {
  await cleanupTestTenant();
});

afterAll(async () => { await closeKnex(); });

describe("postTransaction", () => {
  it("posts a valid customer invoice and debits equal credits", async () => {
    const result = await postTransaction({
      transaction_type: "CUSTOMER_INVOICE", reference: "INV-001", date: "2026-03-15",
      lines: [{ description: "Widget sale", net_amount: "100.0000", tax_amount: "20.0000" }],
      source: { module_id: "test-module" }, idempotency_key: "test-inv-001",
    });
    expect(result.status).toBe("POSTED");
    expect(result.chain_hash).toHaveLength(64);
    const tx = await knex("transactions").where({ idempotency_key: "test-inv-001" }).first();
    expect(tx).toBeDefined();
    const lines = await knex("transaction_lines").where({ transaction_id: tx.transaction_id }).orderBy("line_number");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const totalDebit = lines.reduce((s: number, l: { debit: string }) => s + parseFloat(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: { credit: string }) => s + parseFloat(l.credit), 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.001);
  });

  it("rejects duplicate idempotency key", async () => {
    const sub = {
      transaction_type: "CUSTOMER_INVOICE", reference: "INV-002", date: "2026-03-15",
      lines: [{ description: "Widget", net_amount: "50.0000", tax_amount: "10.0000" }],
      source: { module_id: "test-module" }, idempotency_key: "test-inv-002",
    };
    const first = await postTransaction(sub);
    expect(first.status).toBe("POSTED");
    await expect(postTransaction(sub)).rejects.toThrow(DuplicateIdempotencyKeyError);
  });

  it("chain entries are hash-linked after multiple posts", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { verifyChain } = require("../../src/chain/reader");
    await postTransaction({
      transaction_type: "CUSTOMER_INVOICE", date: "2026-03-15",
      lines: [{ description: "Sale 1", net_amount: "100.0000", tax_amount: "0.0000" }],
      source: { module_id: "test-module" }, idempotency_key: "chain-test-1",
    });
    await postTransaction({
      transaction_type: "CUSTOMER_INVOICE", date: "2026-03-15",
      lines: [{ description: "Sale 2", net_amount: "200.0000", tax_amount: "0.0000" }],
      source: { module_id: "test-module" }, idempotency_key: "chain-test-2",
    });
    const res = verifyChain("2026-03");
    expect(res.valid).toBe(true);
    expect(res.entries).toBeGreaterThanOrEqual(2);
  });
});

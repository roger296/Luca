import { computeEntryHash } from "../../src/chain/hash";
import { buildMerkleTree, verifyProof, generateProof } from "../../src/chain/merkle";
import { createPeriodFile, appendEntry, sealPeriod } from "../../src/chain/writer";
import { verifyChain, getCheckpoint } from "../../src/chain/reader";
import type { PeriodClosePayload } from "../../src/chain/types";
import * as fs from "fs";
import * as path from "path";

// Use a period ID that won't clash with other integration tests
const PERIOD = "chain-test-1";
const ACTUAL_CHAINS_DIR = path.join(process.cwd(), "chains");

function cleanupChainFiles() {
  const fp = path.join(ACTUAL_CHAINS_DIR, PERIOD + ".chain.jsonl");
  if (fs.existsSync(fp)) {
    try { fs.chmodSync(fp, 0o644); } catch { /* ignore */ }
    try { fs.unlinkSync(fp); } catch { /* ignore */ }
  }
}

beforeEach(cleanupChainFiles);
afterEach(cleanupChainFiles);

const txPayload = (id: string) => ({
  transaction_id: id, transaction_type: "MANUAL_JOURNAL",
  reference: null, date: "2026-03-01", currency: "GBP", exchange_rate: "1",
  base_currency: "GBP", counterparty: null, description: "Test",
  lines: [], source: { module_id: "test", module_reference: null, correlation_id: null },
  idempotency_key: null,
});

describe("Chain file operations", () => {
  it("creates genesis with GENESIS previous_hash", async () => {
    const entry = await createPeriodFile(PERIOD, null, {});
    expect(entry.type).toBe("GENESIS");
    expect(entry.previous_hash).toBe("GENESIS");
    expect(entry.entry_hash).toHaveLength(64);
  });

  it("hash-links entries sequentially", async () => {
    await createPeriodFile(PERIOD, null, {});
    const e1 = await appendEntry(PERIOD, "TRANSACTION", txPayload("TXN-001"));
    const e2 = await appendEntry(PERIOD, "TRANSACTION", txPayload("TXN-002"));
    expect(e2.previous_hash).toBe(e1.entry_hash);
    expect(e2.sequence).toBe(e1.sequence + 1);
  });

  it("verifyChain returns valid for correct chain", async () => {
    await createPeriodFile(PERIOD, null, {});
    await appendEntry(PERIOD, "TRANSACTION", txPayload("TXN-001"));
    const result = verifyChain(PERIOD);
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(2);
  });

  it("verifyChain detects tampered hash", async () => {
    await createPeriodFile(PERIOD, null, {});
    await appendEntry(PERIOD, "TRANSACTION", txPayload("TXN-001"));
    const filePath = path.join(ACTUAL_CHAINS_DIR, PERIOD + ".chain.jsonl");
    let content = fs.readFileSync(filePath, "utf8");
    content = content.replace(/"entry_hash":"[0-9a-f]{4}/, '"entry_hash":"XXXX');
    fs.writeFileSync(filePath, content);
    const result = verifyChain(PERIOD);
    expect(result.valid).toBe(false);
  });

  it("recomputed hash matches stored hash", async () => {
    await createPeriodFile(PERIOD, null, {});
    const entry = await appendEntry(PERIOD, "TRANSACTION", txPayload("TXN-001"));
    expect(computeEntryHash(entry)).toBe(entry.entry_hash);
  });
});

describe("Period sealing", () => {
  it("seal generates a valid merkle root and proof verifies", async () => {
    await createPeriodFile(PERIOD, null, {});
    const e1 = await appendEntry(PERIOD, "TRANSACTION", txPayload("TXN-001"));
    const e2 = await appendEntry(PERIOD, "TRANSACTION", txPayload("TXN-002"));
    const closeEntry = await sealPeriod(PERIOD, {
      period_id: PERIOD, closing_trial_balance: {}, total_transactions: 2,
      total_debits: "0.0000", total_credits: "0.0000",
      closed_by: "test@example.com", sub_ledger_reconciliations: {},
    } as Omit<PeriodClosePayload, "merkle_root">);
    expect(closeEntry.type).toBe("PERIOD_CLOSE");
    const payload = closeEntry.payload as PeriodClosePayload;
    expect(payload.merkle_root).toHaveLength(64);
    const checkpoint = getCheckpoint(PERIOD);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.merkle_root).toBe(payload.merkle_root);
    const tree = buildMerkleTree([e1.entry_hash, e2.entry_hash]);
    expect(verifyProof(generateProof(tree, 0))).toBe(true);
    expect(verifyProof(generateProof(tree, 1))).toBe(true);
  });
});

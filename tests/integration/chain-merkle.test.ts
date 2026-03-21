import * as path from "path";
import * as fs from "fs";
import { postTransaction } from "../../src/engine/posting";
import { sealPeriod, readAllEntries } from "../../src/chain/writer";
import { verifyChain, getMerkleProof } from "../../src/chain/reader";
import { buildMerkleTree, getMerkleRoot, generateProof, verifyProof } from "../../src/chain/merkle";
import type { PeriodClosePayload } from "../../src/chain/types";
import {
  setupTestTenant,
  cleanupTestTenant,
  closeKnex,
} from "./helpers";

const ACTUAL_CHAINS_DIR = path.join(process.cwd(), "chains");

function cleanChainFiles(): void {
  if (fs.existsSync(ACTUAL_CHAINS_DIR)) {
    for (const f of fs.readdirSync(ACTUAL_CHAINS_DIR)) {
      if (!f.endsWith(".chain.jsonl")) continue;
      const fp = path.join(ACTUAL_CHAINS_DIR, f);
      try { fs.chmodSync(fp, 0o644); } catch { /* ignore */ }
      try { fs.unlinkSync(fp); } catch { /* ignore */ }
    }
  }
}

beforeAll(async () => { await setupTestTenant(); });
beforeEach(async () => { await cleanupTestTenant(); });
afterEach(async () => { await cleanupTestTenant(); cleanChainFiles(); });
afterAll(async () => { await closeKnex(); });

describe("Merkle integration: 10-transaction period seal", () => {
  it("Merkle root in sealed PERIOD_CLOSE matches fresh computation", async () => {
    // Post 10 transactions
    for (let i = 1; i <= 10; i++) {
      const result = await postTransaction({
        transaction_type: "MANUAL_JOURNAL",
        date: "2026-03-10",
        period_id: "2026-03",
        description: `Merkle integration txn ${i}`,
        lines: [
          { account_code: "1000", description: "Bank",   net_amount: "100.00" },
          { account_code: "3100", description: "Equity", net_amount: "-100.00" },
        ],
        source: { module_id: "test-module" },
        idempotency_key: `merkle-int-${i}`,
      });
      expect(result.status).toBe("POSTED");
    }

    // Seal the period (direct chain operation; DB period status stays OPEN)
    const closeEntry = await sealPeriod("2026-03", {
      period_id: "2026-03",
      closing_trial_balance: {},
      total_transactions: 10,
      total_debits: "1000.00",
      total_credits: "1000.00",
      closed_by: "test-suite",
      sub_ledger_reconciliations: {},
    } as Omit<PeriodClosePayload, "merkle_root">);

    // verifyChain: hash chain valid AND Merkle root valid
    const verifyResult = verifyChain("2026-03");
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.merkle_valid).toBe(true);
    // GENESIS(1) + 10 TRANSACTION + PERIOD_CLOSE(1) = 12 entries
    expect(verifyResult.entries).toBe(12);

    // Stored merkle_root must equal a fresh computation from TRANSACTION entry_hashes
    const allEntries = readAllEntries("2026-03");
    const txHashes = allEntries
      .filter((e) => e.type === "TRANSACTION")
      .map((e) => e.entry_hash);
    expect(txHashes).toHaveLength(10);

    const freshRoot = getMerkleRoot(txHashes);
    const closePayload = closeEntry.payload as PeriodClosePayload;
    expect(closePayload.merkle_root).toBe(freshRoot);
    expect(closePayload.merkle_root).toHaveLength(64);

    // Generate and verify proofs for leaf positions 0 (1st), 4 (5th), 9 (10th)
    const txEntries = allEntries.filter((e) => e.type === "TRANSACTION");
    const tree = buildMerkleTree(txHashes);

    for (const leafIndex of [0, 4, 9]) {
      const proof = generateProof(tree, leafIndex);
      expect(verifyProof(proof)).toBe(true);
      expect(proof.leaf_hash).toBe(txEntries[leafIndex].entry_hash);
      expect(proof.leaf_index).toBe(leafIndex);
      expect(proof.merkle_root).toBe(freshRoot);
    }
  });

  it("getMerkleProof returns a verifiable proof by transaction sequence number", async () => {
    // Post 5 transactions
    for (let i = 1; i <= 5; i++) {
      const result = await postTransaction({
        transaction_type: "MANUAL_JOURNAL",
        date: "2026-03-10",
        period_id: "2026-03",
        description: `Proof by sequence txn ${i}`,
        lines: [
          { account_code: "1000", description: "Bank",   net_amount: "50.00" },
          { account_code: "3100", description: "Equity", net_amount: "-50.00" },
        ],
        source: { module_id: "test-module" },
        idempotency_key: `seq-proof-${i}`,
      });
      expect(result.status).toBe("POSTED");
    }

    // TRANSACTION entries sit at sequences 2..6 (sequence 1 = GENESIS)
    const allEntries = readAllEntries("2026-03");
    const txEntries = allEntries.filter((e) => e.type === "TRANSACTION");
    expect(txEntries).toHaveLength(5);

    // Test getMerkleProof for the 3rd transaction (index 2)
    const targetSeq = txEntries[2].sequence;
    const proof = getMerkleProof("2026-03", targetSeq);
    expect(verifyProof(proof)).toBe(true);
    expect(proof.leaf_hash).toBe(txEntries[2].entry_hash);
    expect(proof.leaf_index).toBe(2);
  });

  it("merkle_position on each TRANSACTION entry has correct index", async () => {
    for (let i = 1; i <= 4; i++) {
      await postTransaction({
        transaction_type: "MANUAL_JOURNAL",
        date: "2026-03-10",
        period_id: "2026-03",
        description: `Position check txn ${i}`,
        lines: [
          { account_code: "1000", description: "Bank",   net_amount: "25.00" },
          { account_code: "3100", description: "Equity", net_amount: "-25.00" },
        ],
        source: { module_id: "test-module" },
        idempotency_key: `pos-check-${i}`,
      });
    }

    const txEntries = readAllEntries("2026-03")
      .filter((e) => e.type === "TRANSACTION");
    expect(txEntries).toHaveLength(4);

    for (let i = 0; i < 4; i++) {
      expect(txEntries[i].merkle_position).not.toBeNull();
      expect(txEntries[i].merkle_position!.index).toBe(i);
      expect(txEntries[i].merkle_position!.depth).toBe(0);
    }
  });

  it("GENESIS and PERIOD_CLOSE entries have merkle_position null", async () => {
    await postTransaction({
      transaction_type: "MANUAL_JOURNAL",
      date: "2026-03-10",
      period_id: "2026-03",
      description: "Null position check",
      lines: [
        { account_code: "1000", description: "Bank",   net_amount: "10.00" },
        { account_code: "3100", description: "Equity", net_amount: "-10.00" },
      ],
      source: { module_id: "test-module" },
      idempotency_key: "null-pos-1",
    });

    await sealPeriod("2026-03", {
      period_id: "2026-03",
      closing_trial_balance: {},
      total_transactions: 1,
      total_debits: "10.00",
      total_credits: "10.00",
      closed_by: "test-suite",
      sub_ledger_reconciliations: {},
    } as Omit<PeriodClosePayload, "merkle_root">);

    const allEntries = readAllEntries("2026-03");
    const genesis = allEntries.find((e) => e.type === "GENESIS");
    const close  = allEntries.find((e) => e.type === "PERIOD_CLOSE");
    expect(genesis).toBeDefined();
    expect(genesis!.merkle_position).toBeNull();
    expect(close).toBeDefined();
    expect(close!.merkle_position).toBeNull();
  });
});

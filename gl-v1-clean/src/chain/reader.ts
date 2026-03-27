import { computeEntryHash } from "./hash";
import { getMerkleRoot, generateProof, buildMerkleTree } from "./merkle";
import { readAllEntries, getLastEntry } from "./writer";
import type { ChainEntry, ChainVerifyResult, MerkleProof } from "./types";

/**
 * Verify the hash chain for a period.
 * Checks sequence ordering, previous_hash linking, and hash recomputation.
 * If the last entry is a PERIOD_CLOSE with a merkle_root, also verifies the Merkle tree.
 */
export function verifyChain(periodId: string): ChainVerifyResult {
  const entries = readAllEntries(periodId);
  if (entries.length === 0) {
    return { valid: true, entries: 0 };
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Check sequence
    if (entry.sequence !== i + 1) {
      return {
        valid: false,
        entries: i,
        error: `Sequence mismatch at position ${i}: expected ${i + 1}, got ${entry.sequence}`,
      };
    }

    // Check previous_hash
    if (i > 0) {
      const expected = entries[i - 1].entry_hash;
      if (entry.previous_hash !== expected) {
        return {
          valid: false,
          entries: i,
          error: `previous_hash mismatch at sequence ${entry.sequence}: expected ${expected}, got ${entry.previous_hash}`,
        };
      }
    }

    // Recompute entry_hash
    const computed = computeEntryHash(entry);
    if (computed !== entry.entry_hash) {
      return {
        valid: false,
        entries: i,
        error: `Hash mismatch at sequence ${entry.sequence}: stored ${entry.entry_hash}, computed ${computed}`,
      };
    }
  }

  // Verify Merkle root if the last entry is a PERIOD_CLOSE
  const last = entries[entries.length - 1];
  let merkle_valid: boolean | undefined;
  if (last.type === "PERIOD_CLOSE") {
    const storedRoot = (last.payload as { merkle_root: string }).merkle_root;
    if (storedRoot) {
      const txHashes = entries
        .filter((e) => e.type === "TRANSACTION")
        .map((e) => e.entry_hash);
      const computedRoot = getMerkleRoot(txHashes);
      merkle_valid = computedRoot === storedRoot;
    }
  }

  return { valid: true, entries: entries.length, merkle_valid };
}

/**
 * Read a single entry by sequence number. Returns null if not found.
 */
export function readEntry(periodId: string, sequence: number): ChainEntry | null {
  const entries = readAllEntries(periodId);
  return entries.find((e) => e.sequence === sequence) || null;
}

/**
 * Get the last entry. Delegates to the writer's fast implementation.
 */
export { getLastEntry } from "./writer";

/**
 * Generate a Merkle proof for a specific transaction entry by its sequence number.
 */
export function getMerkleProof(periodId: string, transactionSequence: number): MerkleProof {
  const entries = readAllEntries(periodId);
  const txEntries = entries.filter((e) => e.type === "TRANSACTION");
  const target = txEntries.findIndex((e) => e.sequence === transactionSequence);
  if (target === -1) {
    throw new Error(`Transaction with sequence ${transactionSequence} not found in period ${periodId}`);
  }
  const tree = buildMerkleTree(txEntries.map((e) => e.entry_hash));
  return generateProof(tree, target);
}

/**
 * Retrieve the closing checkpoint hash and Merkle root for a closed period.
 */
export function getCheckpoint(periodId: string): { closing_hash: string; merkle_root: string } | null {
  const last = getLastEntry(periodId);
  if (!last || last.type !== "PERIOD_CLOSE") return null;
  return {
    closing_hash: last.entry_hash,
    merkle_root: (last.payload as { merkle_root: string }).merkle_root,
  };
}

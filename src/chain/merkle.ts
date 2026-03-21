import { sha256Hex } from "./hash";
import type { MerkleTree, MerkleProof, MerkleProofStep } from "./types";

/**
 * Combine two child hashes into a parent hash.
 * The two hashes are sorted lexicographically before concatenation so that
 * the result is deterministic regardless of which side each child is on.
 */
function combineHashes(a: string, b: string): string {
  return a <= b ? sha256Hex(a + b) : sha256Hex(b + a);
}

/**
 * Build a Merkle tree from an array of leaf hashes (the entry_hash values of
 * TRANSACTION entries in a period).
 *
 * - Empty input  → root is the all-zeros sentinel ("000...000", 64 chars).
 * - Single leaf  → root equals that leaf hash.
 * - Odd count    → the last leaf is duplicated to make the count even.
 *
 * levels[0] = leaves (bottom), levels[last] = [root] (top).
 */
export function buildMerkleTree(entryHashes: string[]): MerkleTree {
  if (entryHashes.length === 0) {
    const emptyRoot = "0".repeat(64);
    return { leaves: [], levels: [[emptyRoot]], root: emptyRoot };
  }

  const leaves = [...entryHashes];
  const levels: string[][] = [leaves];

  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left  = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i]; // duplicate last if odd
      next.push(combineHashes(left, right));
    }
    levels.push(next);
    current = next;
  }

  return {
    leaves,
    levels,
    root: current[0],
  };
}

/**
 * Convenience: compute just the Merkle root from an array of entry hashes.
 */
export function getMerkleRoot(entryHashes: string[]): string {
  return buildMerkleTree(entryHashes).root;
}

/**
 * Generate a Merkle proof for the leaf at leafIndex.
 *
 * The proof allows verification of a single transaction without the full tree.
 * At each level the sibling hash and its position (left/right) are recorded.
 */
export function generateProof(tree: MerkleTree, leafIndex: number): MerkleProof {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(`Leaf index ${leafIndex} is out of range`);
  }

  const proofPath: MerkleProofStep[] = [];
  let idx = leafIndex;

  for (let levelIdx = 0; levelIdx < tree.levels.length - 1; levelIdx++) {
    const level   = tree.levels[levelIdx];
    const isRight = idx % 2 === 1;         // current node is a right-child
    const sibIdx  = isRight ? idx - 1 : idx + 1;

    if (sibIdx < level.length) {
      proofPath.push({
        hash:     level[sibIdx],
        position: isRight ? "left" : "right",
      });
    } else {
      // Odd level — sibling is a duplicate of the current node
      proofPath.push({
        hash:     level[idx],
        position: isRight ? "left" : "right",
      });
    }

    idx = Math.floor(idx / 2);
  }

  return {
    leaf_hash:   tree.leaves[leafIndex],
    leaf_index:  leafIndex,
    proof_path:  proofPath,
    merkle_root: tree.root,
  };
}

/**
 * Verify a Merkle proof without needing the full tree.
 *
 * Recomputes the root by combining the leaf hash with each sibling along the
 * proof path (always sorting the pair lexicographically before hashing) and
 * compares the result to the stored merkle_root.
 */
export function verifyProof(proof: MerkleProof): boolean {
  let current = proof.leaf_hash;

  for (const step of proof.proof_path) {
    current = combineHashes(current, step.hash);
  }

  return current === proof.merkle_root;
}

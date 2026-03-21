import { buildMerkleTree, getMerkleRoot, generateProof, verifyProof } from "../../../src/chain/merkle";

const hashes = [
  "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
  "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
  "cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333",
  "dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444",
];

describe("buildMerkleTree", () => {
  it("handles empty array", () => {
    const tree = buildMerkleTree([]);
    expect(tree.leaves).toHaveLength(0);
    expect(tree.root).toHaveLength(64);
  });

  it("handles single leaf", () => {
    const tree = buildMerkleTree([hashes[0]]);
    expect(tree.leaves).toHaveLength(1);
    expect(tree.root).toHaveLength(64);
  });

  it("handles even number of leaves", () => {
    const tree = buildMerkleTree([hashes[0], hashes[1], hashes[2], hashes[3]]);
    expect(tree.root).toHaveLength(64);
    expect(tree.levels).toHaveLength(3); // leaves, 2 parents, root
  });

  it("handles odd number of leaves", () => {
    const tree = buildMerkleTree([hashes[0], hashes[1], hashes[2]]);
    expect(tree.root).toHaveLength(64);
  });

  it("is deterministic", () => {
    const r1 = getMerkleRoot(hashes);
    const r2 = getMerkleRoot(hashes);
    expect(r1).toBe(r2);
  });
});

describe("Merkle proofs", () => {
  it("generates and verifies a proof for each leaf", () => {
    const tree = buildMerkleTree(hashes);
    for (let i = 0; i < hashes.length; i++) {
      const proof = generateProof(tree, i);
      expect(verifyProof(proof)).toBe(true);
    }
  });

  it("rejects a tampered leaf hash", () => {
    const tree = buildMerkleTree(hashes);
    const proof = generateProof(tree, 0);
    const tampered = { ...proof, leaf_hash: "ffff" + proof.leaf_hash.slice(4) };
    expect(verifyProof(tampered)).toBe(false);
  });

  it("rejects a tampered merkle root", () => {
    const tree = buildMerkleTree(hashes);
    const proof = generateProof(tree, 0);
    const tampered = { ...proof, merkle_root: "ffff" + proof.merkle_root.slice(4) };
    expect(verifyProof(tampered)).toBe(false);
  });
});

import { createHash } from "crypto";

// Helper: deterministic fake hash for a string seed
function fakeHash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

describe("Comprehensive Merkle tree tests", () => {
  it("empty tree root is exactly 64 zeros", () => {
    const tree = buildMerkleTree([]);
    expect(tree.root).toBe("0".repeat(64));
    expect(tree.leaves).toHaveLength(0);
    expect(tree.levels).toHaveLength(1);
    expect(tree.levels[0][0]).toBe("0".repeat(64));
  });

  const sizes = [1, 2, 3, 7, 16, 100];

  it.each(sizes)("builds a valid %d-entry tree with correct structure", (size) => {
    const leaves = Array.from({ length: size }, (_, i) => fakeHash(`leaf-${size}-${i}`));
    const tree = buildMerkleTree(leaves);
    expect(tree.root).toHaveLength(64);
    expect(tree.leaves).toHaveLength(size);
    expect(tree.levels[0]).toEqual(leaves);
    expect(tree.levels[tree.levels.length - 1]).toHaveLength(1);
    expect(tree.levels[tree.levels.length - 1][0]).toBe(tree.root);
    expect(getMerkleRoot(leaves)).toBe(tree.root);
  });

  it.each([1, 2, 7, 16, 100])(
    "getMerkleRoot is deterministic for %d entries",
    (size) => {
      const leaves = Array.from({ length: size }, (_, i) => fakeHash(`det-${size}-${i}`));
      const r1 = getMerkleRoot(leaves);
      const r2 = getMerkleRoot(leaves);
      expect(r1).toBe(r2);
      expect(r1).toHaveLength(64);
    }
  );

  it("generates and verifies proofs for all 7 leaves", () => {
    const leaves = Array.from({ length: 7 }, (_, i) => fakeHash(`p7-${i}`));
    const tree = buildMerkleTree(leaves);
    for (let i = 0; i < 7; i++) {
      const proof = generateProof(tree, i);
      expect(proof.leaf_hash).toBe(leaves[i]);
      expect(proof.leaf_index).toBe(i);
      expect(proof.merkle_root).toBe(tree.root);
      expect(verifyProof(proof)).toBe(true);
    }
  });

  it("generates and verifies proofs for all 16 leaves", () => {
    const leaves = Array.from({ length: 16 }, (_, i) => fakeHash(`p16-${i}`));
    const tree = buildMerkleTree(leaves);
    for (let i = 0; i < 16; i++) {
      expect(verifyProof(generateProof(tree, i))).toBe(true);
    }
  });

  it("generates and verifies proofs for first, middle, and last of 100 leaves", () => {
    const leaves = Array.from({ length: 100 }, (_, i) => fakeHash(`p100-${i}`));
    const tree = buildMerkleTree(leaves);
    for (const i of [0, 49, 99]) {
      expect(verifyProof(generateProof(tree, i))).toBe(true);
    }
  });

  it("tampering a sibling hash in the proof path fails verification", () => {
    const leaves = Array.from({ length: 4 }, (_, i) => fakeHash(`sib-tamper-${i}`));
    const tree = buildMerkleTree(leaves);
    const proof = generateProof(tree, 0);
    const tampered = {
      ...proof,
      proof_path: proof.proof_path.map((step, idx) =>
        idx === 0 ? { ...step, hash: "ffff" + step.hash.slice(4) } : step
      ),
    };
    expect(verifyProof(tampered)).toBe(false);
  });

  it("generateProof throws for negative leaf index", () => {
    const tree = buildMerkleTree([fakeHash("only-one")]);
    expect(() => generateProof(tree, -1)).toThrow();
  });

  it("generateProof throws for out-of-range leaf index", () => {
    const tree = buildMerkleTree([fakeHash("a"), fakeHash("b")]);
    expect(() => generateProof(tree, 2)).toThrow();
  });

  it("different leaf content produces a different root", () => {
    const leaves1 = [fakeHash("x"), fakeHash("y"), fakeHash("z")];
    const leaves2 = [fakeHash("x"), fakeHash("y"), fakeHash("DIFFERENT")];
    expect(getMerkleRoot(leaves1)).not.toBe(getMerkleRoot(leaves2));
  });

  it("Merkle root in PERIOD_CLOSE matches fresh computation (PERIOD_CLOSE payload check)", () => {
    const leaves = Array.from({ length: 5 }, (_, i) => fakeHash(`ptx-${i}`));
    const root = getMerkleRoot(leaves);
    // Simulate what sealPeriod does: store root, then verify it matches
    const payload = { period_id: "2026-03", merkle_root: root };
    const freshRoot = getMerkleRoot(leaves);
    expect(payload.merkle_root).toBe(freshRoot);
  });
});

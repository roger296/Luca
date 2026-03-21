import { canonicalStringify, computeEntryHash } from "../../../src/chain/hash";
import type { ChainEntry } from "../../../src/chain/types";

describe("canonicalStringify", () => {
  it("sorts object keys alphabetically", () => {
    const result = canonicalStringify({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("handles nested objects with sorted keys", () => {
    const result = canonicalStringify({ b: { z: 1, a: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it("handles arrays preserving order", () => {
    const result = canonicalStringify([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("handles null", () => {
    expect(canonicalStringify(null)).toBe("null");
  });

  it("handles strings", () => {
    expect(canonicalStringify("hello")).toBe('"hello"');
  });

  it("handles numbers without trailing zeros", () => {
    expect(canonicalStringify(1250)).toBe("1250");
  });
});

describe("computeEntryHash", () => {
  it("produces a 64-character hex string", () => {
    const entry: ChainEntry = {
      sequence: 1,
      timestamp: "2026-03-04T10:30:00.000Z",
      previous_hash: "GENESIS",
      entry_hash: "computed-below",
      type: "GENESIS",
      merkle_position: null,
      module_signature: null,
      payload: {
        period_id: "2026-03",
        previous_period_id: null,
        previous_period_closing_hash: null,
        previous_period_merkle_root: null,
        opening_balances: {},
      },
    };
    const hash = computeEntryHash(entry);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same hash", () => {
    const entry: ChainEntry = {
      sequence: 1,
      timestamp: "2026-03-04T10:30:00.000Z",
      previous_hash: "GENESIS",
      entry_hash: "",
      type: "GENESIS",
      merkle_position: null,
      module_signature: null,
      payload: {
        period_id: "2026-03",
        previous_period_id: null,
        previous_period_closing_hash: null,
        previous_period_merkle_root: null,
        opening_balances: {},
      },
    };
    const hash1 = computeEntryHash(entry);
    const hash2 = computeEntryHash(entry);
    expect(hash1).toBe(hash2);
  });

  it("entry_hash field does not affect the hash (set to empty string)", () => {
    const base: ChainEntry = {
      sequence: 1,
      timestamp: "2026-03-04T10:30:00.000Z",
      previous_hash: "GENESIS",
      entry_hash: "",
      type: "GENESIS",
      merkle_position: null,
      module_signature: null,
      payload: { period_id: "2026-03", previous_period_id: null, previous_period_closing_hash: null, previous_period_merkle_root: null, opening_balances: {} },
    };
    const hash1 = computeEntryHash({ ...base, entry_hash: "" });
    const hash2 = computeEntryHash({ ...base, entry_hash: "some-previous-value" });
    expect(hash1).toBe(hash2);
  });

  it("different payloads produce different hashes", () => {
    const make = (periodId: string): ChainEntry => ({
      sequence: 1,
      timestamp: "2026-03-04T10:30:00.000Z",
      previous_hash: "GENESIS",
      entry_hash: "",
      type: "GENESIS",
      merkle_position: null,
      module_signature: null,
      payload: { period_id: periodId, previous_period_id: null, previous_period_closing_hash: null, previous_period_merkle_root: null, opening_balances: {} },
    });
    expect(computeEntryHash(make("2026-03"))).not.toBe(computeEntryHash(make("2026-04")));
  });
});

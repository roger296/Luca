import { createHash } from "crypto";
import type { ChainEntry } from "./types";

/**
 * Canonical JSON serialisation — keys sorted alphabetically at every nesting level,
 * no whitespace. Deterministic and reproducible across environments.
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj === "number") return JSON.stringify(obj);
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "boolean") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  // Object: sort keys alphabetically
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ":" + canonicalStringify(val);
  });
  return "{" + pairs.join(",") + "}";
}

/**
 * Compute the entry_hash for a chain entry.
 * The entry_hash field is set to "" before hashing.
 */
export function computeEntryHash(entry: ChainEntry): string {
  const hashInput = { ...entry, entry_hash: "" };
  const canonical = canonicalStringify(hashInput);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * SHA-256 hash of a UTF-8 string, returned as lowercase hex.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

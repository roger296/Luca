import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { computeEntryHash } from './hash';
import type { ChainEntry, ChainVerifyResult } from './types';

export class ChainReader {
  constructor(private readonly chainDir: string) {}

  private getFilePath(periodId: string): string {
    return path.join(this.chainDir, `${periodId}.chain.jsonl`);
  }

  /**
   * Reads all valid entries from a period's chain file.
   *
   * Lines that fail JSON parsing (e.g. a truncated last line from a crash) are
   * silently skipped. The verifier will flag integrity issues separately.
   *
   * Returns an empty array if the file does not exist.
   */
  async readAllEntries(periodId: string): Promise<ChainEntry[]> {
    const filePath = this.getFilePath(periodId);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      return [];
    }

    const entries: ChainEntry[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as ChainEntry);
      } catch {
        // Truncated or corrupted line — skip; verifyChain will catch it.
      }
    }
    return entries;
  }

  /**
   * Returns the entry at the given 1-based sequence number, or null if not
   * found. Requires a linear scan of the file (acceptable for MVP).
   */
  async readEntry(periodId: string, sequence: number): Promise<ChainEntry | null> {
    const entries = await this.readAllEntries(periodId);
    return entries.find((e) => e.sequence === sequence) ?? null;
  }

  /**
   * Returns the last valid entry in the chain file, or null if the file does
   * not exist or contains no valid entries.
   *
   * Optimised: reads backwards in 8 KiB chunks so it only fetches a small
   * portion of large files. This is important because getLastEntry is called
   * on every write operation.
   *
   * If the last line is truncated (crash during write), it is ignored and the
   * second-to-last valid line is returned instead.
   */
  async getLastEntry(periodId: string): Promise<ChainEntry | null> {
    const filePath = this.getFilePath(periodId);

    let fd: fs.FileHandle;
    try {
      fd = await fs.open(filePath, 'r');
    } catch {
      return null;
    }

    try {
      const { size } = await fd.stat();
      if (size === 0) return null;

      const CHUNK = 8192;
      let position = size;
      let accumulated = '';

      while (position > 0) {
        const readSize = Math.min(CHUNK, position);
        position -= readSize;

        const buf = Buffer.alloc(readSize);
        await fd.read(buf, 0, readSize, position);
        accumulated = buf.toString('utf8') + accumulated;

        // Strip the single trailing newline at the very end of the file so
        // the last "line" isn't an empty string.
        const stripped = accumulated.endsWith('\n') ? accumulated.slice(0, -1) : accumulated;

        const lastNL = stripped.lastIndexOf('\n');

        if (lastNL !== -1 || position === 0) {
          // We have the full last line (either ended by a newline, or we've
          // read the entire file into `accumulated`).
          const lastLine = lastNL >= 0 ? stripped.slice(lastNL + 1) : stripped;

          if (!lastLine.trim()) return null;

          try {
            return JSON.parse(lastLine) as ChainEntry;
          } catch {
            // Last line is truncated (crash mid-write). Find the previous line.
            if (lastNL >= 0) {
              const beforeLast = stripped.slice(0, lastNL);
              const prevNL = beforeLast.lastIndexOf('\n');
              const prevLine = prevNL >= 0 ? beforeLast.slice(prevNL + 1) : beforeLast;
              if (prevLine.trim()) {
                try {
                  return JSON.parse(prevLine) as ChainEntry;
                } catch {
                  // Previous line also bad — need more context.
                }
              }
            }
            // Need more data from earlier in the file.
            if (position === 0) return null;
          }
        }
      }

      return null;
    } finally {
      await fd.close();
    }
  }

  /**
   * Verifies the integrity of the hash chain for the given period.
   *
   * Checks:
   * - Sequence numbers are consecutive starting at 1
   * - Each entry's previous_hash matches the preceding entry's entry_hash
   * - Each entry's entry_hash matches a fresh recomputation of its content
   *
   * Cross-period links (the first entry's previous_hash pointing to the
   * previous period's PERIOD_CLOSE) are accepted as-is; verifying them would
   * require reading two chain files and is left to a higher-level check.
   */
  async verifyChain(periodId: string): Promise<ChainVerifyResult> {
    const entries = await this.readAllEntries(periodId);

    if (entries.length === 0) {
      return { valid: true, entries: 0 };
    }

    let expectedSequence = 1;
    let previousEntryHash: string | null = null;

    for (const entry of entries) {
      // 1. Sequence must be exactly expectedSequence.
      if (entry.sequence !== expectedSequence) {
        return {
          valid: false,
          entries: expectedSequence - 1,
          error: `Sequence mismatch at position ${expectedSequence}: expected ${expectedSequence}, got ${entry.sequence}`,
        };
      }

      // 2. previous_hash must match the preceding entry's hash.
      //    For the very first entry we accept whatever is there (GENESIS or a
      //    cross-period hash) — we can't verify it without the previous file.
      if (expectedSequence > 1 && previousEntryHash !== null) {
        if (entry.previous_hash !== previousEntryHash) {
          return {
            valid: false,
            entries: expectedSequence - 1,
            error: `Hash link broken at sequence ${entry.sequence}: previous_hash does not match preceding entry_hash`,
          };
        }
      }

      // 3. Recompute entry_hash and compare.
      const recomputed = computeEntryHash(entry);
      if (recomputed !== entry.entry_hash) {
        return {
          valid: false,
          entries: expectedSequence - 1,
          error: `Hash mismatch at sequence ${entry.sequence}: entry has been tampered with`,
        };
      }

      previousEntryHash = entry.entry_hash;
      expectedSequence++;
    }

    return { valid: true, entries: entries.length };
  }
}

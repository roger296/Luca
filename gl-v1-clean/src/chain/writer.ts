import * as fs from "fs";
import * as path from "path";
import { config } from "../config/index";
import { computeEntryHash } from "./hash";
import { getMerkleRoot } from "./merkle";
import type { ChainEntry, EntryType, ModuleSignature, GenesisPayload, PeriodClosePayload } from "./types";
import { PeriodClosedError, PeriodSoftClosedError } from "../engine/types";
import { knex } from "../db/connection";

const writeLocks = new Map<string, Promise<void>>();

function chainFilePath(periodId: string): string {
  return path.join(config.chains.dir, periodId + ".chain.jsonl");
}

async function acquireLock(key: string): Promise<() => void> {
  let releaseFn!: () => void;
  const nextPromise = new Promise<void>((resolve) => { releaseFn = resolve; });
  const existing = writeLocks.get(key);
  if (existing) { writeLocks.set(key, existing.then(() => nextPromise)); await existing; }
  else { writeLocks.set(key, nextPromise); }
  return releaseFn;
}

export function getLastEntry(periodId: string): ChainEntry | null {
  const filePath = chainFilePath(periodId);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return null;
  const fd = fs.openSync(filePath, "r");
  try {
    const chunkSize = Math.min(4096, stat.size);
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, Math.max(0, stat.size - chunkSize));
    const text = buf.toString("utf8");
    const fileLines = text.trim().split("\n");
    for (let i = fileLines.length - 1; i >= 0; i--) {
      const fl = fileLines[i].trim();
      if (fl) { try { return JSON.parse(fl) as ChainEntry; } catch { /* truncated */ } }
    }
  } finally { fs.closeSync(fd); }
  return null;
}

export function readAllEntries(periodId: string): ChainEntry[] {
  const filePath = chainFilePath(periodId);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const entries: ChainEntry[] = [];
  for (const fl of raw.split("\n")) {
    const trimmed = fl.trim();
    if (!trimmed) continue;
    try { entries.push(JSON.parse(trimmed) as ChainEntry); } catch { /* skip */ }
  }
  return entries;
}

async function checkPeriodStatus(periodId: string, entryType?: string): Promise<void> {
  const period = await knex("periods").where({ period_id: periodId }).first();
  if (!period) return;
  if (period.status === "HARD_CLOSE") throw new PeriodClosedError(periodId);
  // Allow PERIOD_CLOSE entries on SOFT_CLOSE periods (needed by hardClosePeriod -> sealPeriod)
  if (period.status === "SOFT_CLOSE" && entryType !== "PERIOD_CLOSE") throw new PeriodSoftClosedError(periodId);
}

function countTransactionEntries(periodId: string): number {
  return readAllEntries(periodId).filter((e) => e.type === "TRANSACTION").length;
}

export async function appendEntry(
  periodId: string,
  type: EntryType,
  payload: object,
  moduleSignature?: ModuleSignature
): Promise<ChainEntry> {
  const lockKey = periodId;
  const release = await acquireLock(lockKey);
  try {
    await checkPeriodStatus(periodId, type);
    const filePath = chainFilePath(periodId);
    const last = getLastEntry(periodId);
    const previousHash = last ? last.entry_hash : "GENESIS";
    const sequence = last ? last.sequence + 1 : 1;
    const merklePosition = type === "TRANSACTION"
      ? { index: countTransactionEntries(periodId), depth: 0 } : null;
    const entry: ChainEntry = {
      sequence, timestamp: new Date().toISOString(),
      previous_hash: previousHash, entry_hash: "",
      type, merkle_position: merklePosition,
      module_signature: moduleSignature || null,
      payload: payload as ChainEntry["payload"],
    };
    entry.entry_hash = computeEntryHash(entry);
    const fl = JSON.stringify(entry) + "\n";
    const fd = fs.openSync(filePath, "a");
    try { fs.writeSync(fd, fl); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return entry;
  } finally { release(); }
}

export async function createPeriodFile(
  periodId: string,
  previousPeriodId: string | null,
  openingBalances: Record<string, { debit: string; credit: string }>
): Promise<ChainEntry> {
  const dir = config.chains.dir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = chainFilePath(periodId);
  if (fs.existsSync(filePath)) throw new Error("Chain file already exists for period " + periodId);
  let previousPeriodClosingHash: string | null = null;
  let previousPeriodMerkleRoot: string | null = null;
  let previousHash = "GENESIS";
  if (previousPeriodId) {
    const prevLast = getLastEntry(previousPeriodId);
    if (prevLast && prevLast.type === "PERIOD_CLOSE") {
      previousPeriodClosingHash = prevLast.entry_hash;
      previousPeriodMerkleRoot = (prevLast.payload as PeriodClosePayload).merkle_root;
      previousHash = prevLast.entry_hash;
    }
  }
  const genesisPayload: GenesisPayload = {
    period_id: periodId, previous_period_id: previousPeriodId,
    previous_period_closing_hash: previousPeriodClosingHash,
    previous_period_merkle_root: previousPeriodMerkleRoot,
    opening_balances: openingBalances,
  };
  const entry: ChainEntry = {
    sequence: 1, timestamp: new Date().toISOString(),
    previous_hash: previousHash, entry_hash: "",
    type: "GENESIS", merkle_position: null, module_signature: null,
    payload: genesisPayload,
  };
  entry.entry_hash = computeEntryHash(entry);
  const fl = JSON.stringify(entry) + "\n";
  fs.writeFileSync(filePath, fl, { encoding: "utf8" });
  const fd = fs.openSync(filePath, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return entry;
}

export async function sealPeriod(
  periodId: string,
  closingPayload: Omit<PeriodClosePayload, "merkle_root">
): Promise<ChainEntry> {
  const entries = readAllEntries(periodId);
  const txHashes = entries.filter((e) => e.type === "TRANSACTION").map((e) => e.entry_hash);
  const merkleRoot = getMerkleRoot(txHashes);
  const fullPayload: PeriodClosePayload = { ...closingPayload, merkle_root: merkleRoot };
  const entry = await appendEntry(periodId, "PERIOD_CLOSE", fullPayload);
  const filePath = chainFilePath(periodId);
  try { fs.chmodSync(filePath, 0o444); } catch { /* non-fatal on Windows */ }
  return entry;
}

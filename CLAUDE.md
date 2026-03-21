# Modular Accounting Platform — General Ledger V1

## Project Overview

This is the General Ledger (GL) module V1 for a modular business accounting platform. V1 extends the MVP with multi-currency support, Merkle trees, digital signatures, webhook event publishing, an MCP server for AI agent access, advanced reporting (P&L, balance sheet, cash flow), enhanced approval workflows, bulk operations, and a significantly richer web frontend.

**IMPORTANT — AI Agent Access is a Core Interface:** This platform is designed to be operated by AI agents — such as Claude in Cowork mode, Claude Code, or any MCP-compatible assistant — alongside traditional human users and system-to-system API integrations. Every module must publish an MCP server as a mandatory part of its interface. The MCP server, the REST API, and the web UI are three equal access methods that all call the same backend engine. The expectation is that many businesses will use an AI agent as their primary day-to-day interface with the accounting system, with the web UI serving as a supervisory and exception-handling tool.

**IMPORTANT — Single-Tenant Architecture:** This platform is designed exclusively as a single-tenant system. Each deployment serves exactly one company. Multi-tenant operation (multiple companies sharing a single instance or database) is explicitly not supported and must never be implemented. There is no tenant_id column, no tenant filtering on queries, and no tenant resolution middleware. The database, chain files, and application state all belong to a single company. This simplifies the codebase, strengthens the integrity guarantees of the immutable chain, and aligns with the expectation that most users will self-host on their own hardware or cloud accounts.

The MVP codebase already exists and implements: chain file writer with hash linking, core posting engine with double-entry validation, chart of accounts CRUD, period management (open/soft-close/hard-close), basic approval workflow (auto-approve below threshold), trial balance, REST API, React web UI, Docker Compose, and a test suite.

See `docs/System Architecture Overview.md` for the full platform architecture. V1 implements the complete GL module as described in Sections 2.1 through 2.7 and Sections 10 and 11 of that document, plus the MCP server.

## Tech Stack

- **Language**: TypeScript (strict mode enabled)
- **Runtime**: Node.js 20+
- **Framework**: Express.js for the REST API
- **Database**: PostgreSQL 16 (the "mirror" database for queries and reporting)
- **Chain files**: Custom append-only JSONL files stored on the local filesystem (the authoritative ledger)
- **Frontend**: React with TypeScript, TanStack Query for server state, Zustand for client state
- **Containerisation**: Docker and Docker Compose
- **Testing**: Jest for unit and integration tests
- **ORM/Query builder**: Knex.js for database access (explicit SQL control, not a full ORM)
- **MCP Server**: `@modelcontextprotocol/sdk` for AI agent integration
- **Webhooks**: Internal event emitter + HTTP delivery with retry logic

## V1 Project Structure

```
gl-v1/
├── CLAUDE.md                 <- You are here
├── docker-compose.yml        <- Local development environment
├── docs/
│   ├── System Architecture Overview.md
│   └── MCP_SERVER_SPEC.md    <- MCP server detailed specification
├── src/
│   ├── server.ts             <- Express app entry point
│   ├── config/
│   │   └── index.ts          <- Environment configuration
│   ├── api/
│   │   ├── routes.ts         <- API route definitions (all v1 endpoints)
│   │   ├── transactions.ts   <- Transaction posting endpoints (incl. bulk)
│   │   ├── accounts.ts       <- Chart of accounts endpoints
│   │   ├── periods.ts        <- Period management endpoints
│   │   ├── reports.ts        <- Trial balance, P&L, balance sheet, cash flow
│   │   ├── approvals.ts      <- Approval queue management endpoints
│   │   ├── chain.ts          <- Chain verification and checkpoint endpoints
│   │   ├── webhooks.ts       <- Webhook subscription management
│   │   ├── transaction-types.ts <- Transaction type discovery endpoint
│   │   └── middleware/
│   │       ├── auth.ts       <- JWT authentication with module identity
│   │       ├── validation.ts <- Zod-based request validation
│   │       └── errors.ts     <- Error handling middleware
│   ├── chain/
│   │   ├── writer.ts         <- Append-only chain file writer
│   │   ├── reader.ts         <- Chain file reader and verifier
│   │   ├── hash.ts           <- SHA-256 hashing utilities (canonical JSON)
│   │   ├── merkle.ts         <- Merkle tree construction and proof generation
│   │   ├── signatures.ts     <- Module digital signature verification
│   │   └── types.ts          <- Chain file data structures
│   ├── db/
│   │   ├── connection.ts     <- Database connection pool
│   │   ├── migrations/       <- Knex migration files (V1 additions)
│   │   └── queries/          <- Query functions by domain
│   │       ├── accounts.ts
│   │       ├── transactions.ts
│   │       ├── periods.ts
│   │       ├── reports.ts    <- P&L, balance sheet, cash flow queries
│   │       ├── approvals.ts  <- Approval queue and rule queries
│   │       └── webhooks.ts   <- Webhook subscription queries
│   ├── engine/
│   │   ├── posting.ts        <- Core posting logic (validate, expand, commit)
│   │   ├── approval.ts       <- Full approval workflow (delegation, escalation, multi-level, SoD)
│   │   ├── periods.ts        <- Period state management and closing
│   │   ├── mappings.ts       <- Transaction type to account mappings
│   │   ├── currency.ts       <- Multi-currency handling and FX revaluation
│   │   ├── webhooks.ts       <- Event publishing logic with retry
│   │   ├── reports.ts        <- P&L, balance sheet, cash flow generation
│   │   └── types.ts          <- Domain types and interfaces
│   ├── mcp/
│   │   ├── server.ts         <- MCP server entry point (stdio transport)
│   │   ├── tools.ts          <- MCP tool definitions and handlers
│   │   ├── resources.ts      <- MCP resource definitions (chart of accounts, periods, tax codes)
│   │   └── auth.ts           <- MCP authentication bridge
│   └── web/                  <- React frontend
│       ├── src/
│       │   ├── App.tsx
│       │   ├── store/        <- Zustand stores
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx
│       │   │   ├── Journal.tsx
│       │   │   ├── AccountLedger.tsx
│       │   │   ├── ApprovalQueue.tsx
│       │   │   ├── ChartOfAccounts.tsx
│       │   │   ├── PeriodManagement.tsx
│       │   │   ├── TrialBalance.tsx
│       │   │   ├── ProfitAndLoss.tsx
│       │   │   ├── BalanceSheet.tsx
│       │   │   ├── CashFlow.tsx
│       │   │   ├── AuditTrail.tsx
│       │   │   └── WebhookManagement.tsx
│       │   ├── components/    <- Shared UI components
│       │   └── hooks/         <- TanStack Query hooks for API calls
│       └── package.json
├── tests/
│   ├── unit/
│   │   ├── chain/
│   │   ├── engine/
│   │   ├── mcp/
│   │   └── api/
│   └── integration/
│       ├── posting.test.ts
│       ├── approval.test.ts
│       ├── periods.test.ts
│       ├── chain-integrity.test.ts
│       ├── multicurrency.test.ts
│       ├── webhooks.test.ts
│       ├── reports.test.ts
│       ├── bulk-posting.test.ts
│       └── mcp-tools.test.ts
├── knexfile.ts
├── tsconfig.json
├── package.json
└── Dockerfile
```

## Key Architecture Rules

These rules are non-negotiable and must be followed in all code:

1. **The chain file is the source of truth.** Every committed transaction is written to the chain file FIRST, then to the database. If the database write fails after the chain write succeeds, that is acceptable — the database can be rebuilt from chain files. The reverse (database write without chain write) must never happen.

2. **Double-entry always balances.** Every transaction must have debits equal to credits. The posting engine must validate this before committing. No transaction that does not balance may be written to the chain file. This validation must be tested extensively.

3. **The chain is append-only and hash-linked.** Each entry in a chain file contains the SHA-256 hash of the previous entry. The first entry in each period's chain file contains the closing checkpoint hash of the previous period. No mechanism exists to modify or delete a chain file entry.

4. **Closed periods are immutable.** Once a period is hard-closed, its chain file must reject any attempt to append. Post-close corrections are posted as PRIOR_PERIOD_ADJUSTMENT transactions in the current open period.

5. **All transactions flow through the approval workflow.** Transactions enter the staging area first. Approval rules determine whether they are auto-approved or require manual review. Only approved transactions are committed to the chain.

6. **The API is the only way in.** The web frontend calls the same API as external modules would. There is no back door. All business logic lives in the engine layer, not in the API handlers or the frontend.

7. **Monetary amounts use Decimal.js.** Never use JavaScript floating point for money. All monetary calculations use Decimal.js. Store monetary values as strings in JSON and numeric(19,4) in PostgreSQL.

8. **Multi-currency amounts are always dual-recorded.** Every monetary amount is stored in both the transaction currency AND the base currency. The exchange rate used for conversion is stored on the transaction.

9. **Single-tenant architecture.** Each deployment serves exactly one company. There is no tenant_id column, no tenant filtering, and no multi-tenant capability. The database, chain files, and application state belong entirely to the single company operating this instance.

10. **The MCP server is a mandatory, first-class interface — not an add-on.** It calls the same engine layer as the REST API. Same validation, same approval workflow, same audit trail. AI agents operating through MCP are expected to be a primary way businesses interact with this system. The MCP server must expose every operation that the REST API exposes.

## Chain File Format — Detailed Specification

### File Location and Naming

Each period has its own chain file: `chains/{periodId}.chain.jsonl`

Period IDs use the format `YYYY-MM` (e.g., `2026-03` for March 2026).

The file is a JSONL file — each line is a complete, self-contained JSON object terminated by a newline character (`\n`). Appending a new line does not require reading or modifying any existing content.

### Entry Structure

Every entry in the chain file has this exact structure:

```json
{
  "sequence": 1,
  "timestamp": "2026-03-04T10:30:00.000Z",
  "previous_hash": "GENESIS",
  "entry_hash": "a1b2c3d4e5f6...(full 64-char hex SHA-256)",
  "type": "TRANSACTION",
  "merkle_position": { "index": 0, "depth": 0 },
  "module_signature": null,
  "payload": { }
}
```

Field definitions:
- `sequence` — integer, starts at 1 for each period, increments by 1 for every entry. No gaps allowed.
- `timestamp` — UTC ISO 8601 timestamp of when the entry was written to the chain. This is the commit time, not the transaction date.
- `previous_hash` — the `entry_hash` of the immediately preceding entry in this file. For the very first entry in a period, see "Genesis and Cross-Period Linking" below.
- `entry_hash` — SHA-256 hash of the canonical form of this entry (see "Hash Computation" below).
- `type` — one of: `"TRANSACTION"`, `"PERIOD_CLOSE"`, `"GENESIS"`.
- `merkle_position` — the entry's position in the period's Merkle tree. Used for efficient single-transaction verification without reprocessing the entire chain.
- `module_signature` — if the submitting module provided a digital signature, it is stored here. The GL verifies signatures but does not require them (backwards-compatible with unsigned submissions).
- `payload` — the data for this entry. Structure depends on `type`.

### Hash Computation — Step by Step

This is the most critical algorithm in the system. It must be implemented exactly as described.

To compute the `entry_hash` for a new entry:

1. Construct the entry object with all fields populated EXCEPT `entry_hash` (set it to an empty string `""`).
2. Serialise the object to a JSON string using **canonical serialisation**: keys sorted alphabetically at every level of nesting, no whitespace (no spaces after colons or commas), numbers serialised without trailing zeros (use `1250` not `1250.00`). Use a deterministic JSON serialiser — the built-in `JSON.stringify` with a key-sorting replacer, or a library like `json-canonical`.
3. Compute the SHA-256 hash of the resulting UTF-8 byte string.
4. Express the hash as a lowercase hexadecimal string (64 characters).
5. Set this value as the `entry_hash` field.

**Why canonical serialisation matters:** If the same logical data produces different JSON strings (due to key ordering or whitespace differences), the hashes will differ and chain verification will fail. The serialisation must be deterministic and reproducible.

**Implementation:**

```typescript
import { createHash } from 'crypto';

function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj === 'number') return JSON.stringify(obj);
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'boolean') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  // Object: sort keys alphabetically
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(key => {
    const val = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalStringify(val);
  });
  return '{' + pairs.join(',') + '}';
}

function computeEntryHash(entry: ChainEntry): string {
  const hashInput = { ...entry, entry_hash: "" };
  const canonical = canonicalStringify(hashInput);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

### Merkle Tree Enhancement (NEW in V1)

Within each period, transactions are structured as a Merkle tree. The Merkle tree enables efficient single-transaction verification without reprocessing the entire chain.

**How it works:**

1. Each transaction entry is a leaf node in the Merkle tree.
2. Leaf hashes are the `entry_hash` values of the transaction entries.
3. Parent nodes are computed by hashing the concatenation of their two children's hashes (left + right, sorted lexicographically to ensure determinism).
4. If the number of leaves is odd, the last leaf is duplicated.
5. The Merkle root is computed when the period is closed and included in the PERIOD_CLOSE entry.

**The `merkle_position` field on each entry:**

```typescript
interface MerklePosition {
  index: number;   // 0-based position among transaction entries in this period
  depth: number;   // always 0 for leaf nodes (transaction entries)
}
```

**Merkle proof generation** (`src/chain/merkle.ts`):

```typescript
interface MerkleProof {
  leaf_hash: string;           // the entry_hash of the transaction
  leaf_index: number;          // position in the tree
  proof_path: MerkleProofStep[];  // the sibling hashes needed to verify
  merkle_root: string;         // the expected root
}

interface MerkleProofStep {
  hash: string;       // the sibling node's hash
  position: 'left' | 'right';  // whether the sibling is left or right
}
```

To verify a single transaction, a verifier needs only the transaction's hash plus the proof path (typically log2(N) hashes), not the entire period's data.

**Implementation requirements for `src/chain/merkle.ts`:**

1. `buildMerkleTree(entryHashes: string[]): MerkleTree` — constructs the full tree from an array of entry hashes. Returns the tree structure including the root.
2. `getMerkleRoot(entryHashes: string[]): string` — convenience method returning just the root hash.
3. `generateProof(tree: MerkleTree, leafIndex: number): MerkleProof` — generates the proof path for a specific transaction.
4. `verifyProof(proof: MerkleProof): boolean` — verifies a proof without needing the full tree.

The Merkle root is computed during period close and stored in the PERIOD_CLOSE entry payload.

### Digital Signatures (NEW in V1)

Modules can optionally sign their transaction submissions. The GL verifies signatures but does not require them — this maintains backwards compatibility with the MVP and with simple modules that don't implement signing.

**How module signing works:**

1. Each module registers a public key with the GL during module registration.
2. When submitting a transaction, the module signs the canonical JSON of the transaction payload with its private key (Ed25519).
3. The signature is included in the API request as a `module_signature` field.
4. The GL verifies the signature against the module's registered public key.
5. If verification passes, the signature is stored on the chain entry.
6. If verification fails, the transaction is rejected with error code `INVALID_MODULE_SIGNATURE`.

**Signature storage on the chain entry:**

```json
{
  "module_signature": {
    "module_id": "sales-and-customer",
    "algorithm": "Ed25519",
    "signature": "base64-encoded-signature-bytes",
    "public_key_fingerprint": "sha256-of-public-key"
  }
}
```

If the module did not provide a signature, `module_signature` is `null`.

**Implementation in `src/chain/signatures.ts`:**

```typescript
import { verify } from 'crypto';

interface ModuleSignature {
  module_id: string;
  algorithm: 'Ed25519';
  signature: string;  // base64
  public_key_fingerprint: string;
}

function verifyModuleSignature(
  payload: object,
  signature: ModuleSignature,
  registeredPublicKey: Buffer
): boolean {
  const canonical = canonicalStringify(payload);
  return verify(
    null,  // Ed25519 doesn't use a separate hash algorithm
    Buffer.from(canonical, 'utf8'),
    registeredPublicKey,
    Buffer.from(signature.signature, 'base64')
  );
}
```

### Genesis and Cross-Period Linking

The first entry in each period's chain file is a `GENESIS` entry that links this period to the previous one.

**For the very first period ever (no previous period exists):**
```json
{
  "sequence": 1,
  "timestamp": "2026-03-01T00:00:00.000Z",
  "previous_hash": "GENESIS",
  "entry_hash": "(computed)",
  "type": "GENESIS",
  "merkle_position": null,
  "module_signature": null,
  "payload": {
    "period_id": "2026-03",
    "previous_period_id": null,
    "previous_period_closing_hash": null,
    "previous_period_merkle_root": null,
    "opening_balances": {}
  }
}
```

The literal string `"GENESIS"` is used as `previous_hash` only for the very first entry in the very first period.

**For subsequent periods (previous period has been closed):**
```json
{
  "sequence": 1,
  "timestamp": "2026-04-01T00:15:01.000Z",
  "previous_hash": "(entry_hash of the PERIOD_CLOSE entry from previous period)",
  "entry_hash": "(computed)",
  "type": "GENESIS",
  "merkle_position": null,
  "module_signature": null,
  "payload": {
    "period_id": "2026-04",
    "previous_period_id": "2026-03",
    "previous_period_closing_hash": "(entry_hash of the PERIOD_CLOSE from 2026-03)",
    "previous_period_merkle_root": "(merkle root from 2026-03)",
    "opening_balances": {
      "1000": { "debit": "15420.50", "credit": "0" },
      "1100": { "debit": "8200.00", "credit": "0" },
      "2000": { "debit": "0", "credit": "3150.00" }
    }
  }
}
```

Note: All monetary values in opening_balances are strings to avoid floating point issues.

### Transaction Entry Payload (V1 — with multi-currency)

```json
{
  "transaction_id": "TXN-2026-03-00001",
  "transaction_type": "CUSTOMER_INVOICE",
  "reference": "INV-2026-00142",
  "date": "2026-03-04",
  "currency": "EUR",
  "exchange_rate": "1.1650",
  "base_currency": "GBP",
  "counterparty": {
    "trading_account_id": "TA-CUST-0445-EUR",
    "contact_id": "CONTACT-0087"
  },
  "description": "Sale of widgets to Northern Building Supplies (EUR)",
  "lines": [
    {
      "account_code": "1100-TRADE_DEBTORS",
      "description": "Trade debtors",
      "debit": "5382.90",
      "credit": "0",
      "base_debit": "4620.00",
      "base_credit": "0",
      "cost_centre": "SALES_NORTH"
    },
    {
      "account_code": "4000-SALES_TRADE",
      "description": "Trade sales revenue",
      "debit": "0",
      "credit": "4487.42",
      "base_debit": "0",
      "base_credit": "3850.00",
      "cost_centre": "SALES_NORTH"
    },
    {
      "account_code": "2200-VAT_OUTPUT",
      "description": "VAT output tax",
      "debit": "0",
      "credit": "895.48",
      "base_debit": "0",
      "base_credit": "770.00"
    }
  ],
  "source": {
    "module_id": "sales-and-customer",
    "module_reference": "SO-2026-0891",
    "correlation_id": "saga-2026-03-02-00441"
  },
  "idempotency_key": "sales-INV-2026-00142"
}
```

**Critical multi-currency rules:**
- Every line has BOTH transaction-currency amounts (`debit`/`credit`) and base-currency amounts (`base_debit`/`base_credit`).
- Both sets of amounts must independently balance (total debits = total credits in each currency).
- The `exchange_rate` field records the rate used: `1 unit of transaction currency = exchange_rate units of base currency`.
- When `currency` equals `base_currency`, the exchange_rate is `"1"` and the base amounts equal the transaction amounts.
- All amounts are strings (not numbers) to preserve decimal precision.
- The database stores both sets of amounts in numeric(19,4) columns.

### Period Close Entry Payload (V1 — with Merkle root)

```json
{
  "period_id": "2026-03",
  "merkle_root": "(computed Merkle root hash of all transaction entries)",
  "closing_trial_balance": {
    "1000": { "debit": "18750.50", "credit": "0" },
    "1100": { "debit": "12400.00", "credit": "0" },
    "2000": { "debit": "0", "credit": "5320.00" },
    "4000": { "debit": "0", "credit": "42800.00" }
  },
  "total_transactions": 541,
  "total_debits": "284500.00",
  "total_credits": "284500.00",
  "closed_by": "finance.controller@company.com",
  "sub_ledger_reconciliations": {
    "sales-and-customer": { "confirmed": true, "confirmed_at": "2026-04-01T09:00:00Z" },
    "purchasing-and-supplier": { "confirmed": true, "confirmed_at": "2026-04-01T09:15:00Z" }
  }
}
```

### Chain File Writer — Implementation Requirements

The writer (`src/chain/writer.ts`) must implement these operations:

**`appendEntry(periodId: string, type: EntryType, payload: object, moduleSignature?: ModuleSignature): ChainEntry`**

Step-by-step logic:

1. Acquire a write lock for this period's chain file. Only one write may be in progress at a time per file. Use a mutex (in-memory Map<string, Mutex> keyed by `{periodId}`).
2. Check the period status in the database. If the period is `HARD_CLOSE`, throw a `PeriodClosedError`. If the period is `SOFT_CLOSE` and the caller does not have soft-close override permission, throw a `PeriodSoftClosedError`.
3. If `moduleSignature` is provided, verify it against the module's registered public key. If verification fails, throw `InvalidModuleSignatureError`.
4. Read the last line of the chain file to get the previous entry's `entry_hash` and `sequence`. If the file does not exist (new period), this is the genesis case — see below.
5. Compute `merkle_position`: for TRANSACTION entries, this is `{ index: transactionCount, depth: 0 }` where transactionCount is the number of TRANSACTION entries already in the file (excluding GENESIS). For GENESIS and PERIOD_CLOSE entries, `merkle_position` is `null`.
6. Construct the new entry object: `sequence` = previous sequence + 1, `timestamp` = current UTC time, `previous_hash` = previous entry's `entry_hash`, `type` and `payload` as provided, `module_signature` as provided or null, `entry_hash` = `""` (placeholder).
7. Compute `entry_hash` using the hash computation algorithm described above.
8. Set `entry_hash` on the entry.
9. Serialise the entry to a single JSON line (compact, no newlines within the JSON) followed by `\n`.
10. Append this line to the chain file.
11. Call `fsync` on the file descriptor to ensure the write is durable on disk.
12. Release the write lock.
13. Return the completed entry.

**`createPeriodFile(periodId: string, previousPeriodId: string | null, openingBalances: object): ChainEntry`**

Creates a new chain file with a GENESIS entry:

1. Construct the full path: `chains/{periodId}.chain.jsonl`.
2. Ensure the chains directory exists (create if not).
3. Verify the file does not already exist. If it does, throw an error.
4. If `previousPeriodId` is provided, read the last entry of the previous period's chain file and verify it is a `PERIOD_CLOSE` entry. Extract its `entry_hash` and the `merkle_root` from its payload.
5. Construct the GENESIS entry with `previous_hash` set to the previous period's closing hash (or the literal string `"GENESIS"` if this is the first period).
6. Write the entry as the first line of the new file.
7. Fsync.
8. Return the GENESIS entry.

**`sealPeriod(periodId: string, closingPayload: object): ChainEntry`**

Writes the PERIOD_CLOSE entry and makes the file read-only:

1. Compute the Merkle root from all TRANSACTION entries in this period's file. Call `getMerkleRoot()` with the entry_hashes of all TRANSACTION entries (not GENESIS).
2. Add `merkle_root` to the closing payload.
3. Append a PERIOD_CLOSE entry using `appendEntry`.
4. After the entry is written and fsynced, set the file permissions to read-only (chmod 444).
5. Return the PERIOD_CLOSE entry.

### Chain File Reader — Implementation Requirements

The reader (`src/chain/reader.ts`) must implement:

**`verifyChain(periodId: string): { valid: boolean, entries: number, merkle_valid?: boolean, error?: string }`**

Step-by-step logic:

1. Open the chain file for the given period.
2. Read each line sequentially.
3. For each entry:
   a. Parse the JSON.
   b. Verify `sequence` is exactly 1 more than the previous entry (or 1 for the first entry).
   c. Verify `previous_hash` matches the `entry_hash` of the previous entry (or is `"GENESIS"` / previous period's closing hash for the first entry).
   d. Recompute the entry's hash: take the entry, set `entry_hash` to `""`, canonically serialise, SHA-256 hash. Compare the result to the stored `entry_hash`. If they do not match, return `{ valid: false, error: "Hash mismatch at sequence N" }`.
4. If the last entry is a PERIOD_CLOSE entry with a `merkle_root`, verify the Merkle root by collecting all TRANSACTION entry hashes and computing the root. Compare with the stored root.
5. Return `{ valid: true, entries: N, merkle_valid: true/false/undefined }`.

**`readEntry(periodId: string, sequence: number): ChainEntry | null`**

Read a specific entry by sequence number.

**`readAllEntries(periodId: string): ChainEntry[]`**

Read all entries for a period. Used for rebuilding the database mirror.

**`getLastEntry(periodId: string): ChainEntry | null`**

Read only the last entry. Optimise by seeking to the end of the file and reading backwards to find the last newline. This is called on every write operation so it should be fast.

**`getMerkleProof(periodId: string, transactionSequence: number): MerkleProof`**

Generate a Merkle proof for a specific transaction. Reads all TRANSACTION entries, builds the Merkle tree, and returns the proof path.

### Chain File Edge Cases and Error Handling

These cases MUST be handled correctly:

- **Concurrent writes**: Two API requests try to write to the same period simultaneously. The write lock must ensure they are serialised. The second write must see the first write's hash.
- **Crash during write**: On restart, the last line may be truncated. The reader must detect JSON parse failure on the last line. The writer must truncate the incomplete line before resuming writes.
- **Empty chain file**: Handle gracefully.
- **File does not exist**: `appendEntry` should throw; `createPeriodFile` should succeed.
- **Disk full**: The fsync or write fails. The entry must NOT be considered committed.
- **Read-only file**: After period close, chmod 444. The application-level check catches this first.
- **Chains directory missing**: Create it on first write.

## Database Schema (PostgreSQL Mirror)

### V1 Migration Additions (on top of MVP schema)

The following new tables and columns are needed for V1. Create new migration files — do NOT modify existing MVP migrations.

**New columns on existing tables:**

```sql
-- Add to transactions table
ALTER TABLE transactions ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'GBP';
ALTER TABLE transactions ADD COLUMN exchange_rate NUMERIC(19,8);
ALTER TABLE transactions ADD COLUMN base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP';
ALTER TABLE transactions ADD COLUMN module_signature JSONB;
ALTER TABLE transactions ADD COLUMN merkle_index INTEGER;

-- Add to transaction_lines table
ALTER TABLE transaction_lines ADD COLUMN base_debit NUMERIC(19,4) NOT NULL DEFAULT 0;
ALTER TABLE transaction_lines ADD COLUMN base_credit NUMERIC(19,4) NOT NULL DEFAULT 0;

-- Add to periods table
ALTER TABLE periods ADD COLUMN merkle_root VARCHAR(64);
ALTER TABLE periods ADD COLUMN sub_ledger_reconciliations JSONB;
```

**New tables:**

```sql
-- Module registry (for digital signatures)
CREATE TABLE registered_modules (
  module_id VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  public_key TEXT,  -- PEM-encoded Ed25519 public key, nullable if module doesn't sign
  allowed_transaction_types TEXT[] NOT NULL,  -- array of transaction type codes this module can post
  is_active BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook subscriptions
CREATE TABLE webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL,  -- e.g., ['TRANSACTION_POSTED', 'PERIOD_CLOSED']
  secret VARCHAR(255) NOT NULL,  -- HMAC secret for payload signing
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delivery_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0
);

-- Webhook delivery log
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL,  -- 'PENDING', 'DELIVERED', 'FAILED', 'RETRYING'
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_response_status INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Approval delegation
CREATE TABLE approval_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_id VARCHAR(255) NOT NULL,  -- user delegating authority
  delegate_id VARCHAR(255) NOT NULL,   -- user receiving authority
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  scope JSONB,  -- optional: limit delegation to certain types/amounts
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exchange rates (for FX revaluation)
CREATE TABLE exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate NUMERIC(19,8) NOT NULL,
  effective_date DATE NOT NULL,
  source VARCHAR(100),  -- e.g., 'manual', 'ecb', 'openexchangerates'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_currency, to_currency, effective_date)
);

-- Sub-ledger reconciliation confirmations
CREATE TABLE sub_ledger_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id VARCHAR(10) NOT NULL,
  module_id VARCHAR(100) NOT NULL,
  control_account VARCHAR(20) NOT NULL,
  module_balance NUMERIC(19,4) NOT NULL,
  gl_balance NUMERIC(19,4) NOT NULL,
  is_reconciled BOOLEAN NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);
```

### Index Strategy

Add these indexes for V1 performance:

```sql
CREATE INDEX idx_transactions_period ON transactions(period_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_counterparty ON transactions(counterparty_trading_account_id);
CREATE INDEX idx_transactions_correlation ON transactions(correlation_id);
CREATE INDEX idx_transaction_lines_account ON transaction_lines(account_code);
CREATE INDEX idx_staging_period ON staging(period_id);
CREATE INDEX idx_staging_status ON staging(status);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status, created_at);
CREATE INDEX idx_exchange_rates_lookup ON exchange_rates(from_currency, to_currency, effective_date DESC);
```

## V1 Transaction Types

Implement ALL of these transaction types:

**Sales and Receivables:**
- `CUSTOMER_INVOICE` — debit Debtors, credit Revenue, credit VAT Output
- `CUSTOMER_CREDIT_NOTE` — reverse of CUSTOMER_INVOICE
- `CUSTOMER_PAYMENT` — debit Bank, credit Debtors
- `BAD_DEBT_WRITE_OFF` — debit Bad Debt Expense, credit Debtors

**Purchasing and Payables:**
- `SUPPLIER_INVOICE` — debit Expense/Stock, debit VAT Input, credit Creditors
- `SUPPLIER_CREDIT_NOTE` — reverse of SUPPLIER_INVOICE
- `SUPPLIER_PAYMENT` — debit Creditors, credit Bank

**Stock and Inventory:**
- `STOCK_RECEIPT` — debit Stock, credit GRNI (Goods Received Not Invoiced)
- `STOCK_DISPATCH` — debit COGS, credit Stock
- `STOCK_WRITE_OFF` — debit Write-Off Expense, credit Stock
- `STOCK_TRANSFER` — debit Stock (new location), credit Stock (old location) — balance-sheet neutral
- `STOCK_REVALUATION` — debit/credit Stock, contra to Revaluation Reserve

**Banking and Cash:**
- `BANK_RECEIPT` — debit Bank, credit specified account
- `BANK_PAYMENT` — debit specified account, credit Bank
- `BANK_TRANSFER` — debit receiving Bank, credit sending Bank

**Adjustments and Period End:**
- `MANUAL_JOURNAL` — direct debit/credit lines provided explicitly by the accountant
- `PRIOR_PERIOD_ADJUSTMENT` — correction referencing a closed period (requires adjustment_context)
- `PERIOD_END_ACCRUAL` — debit Expense, credit Accruals
- `PREPAYMENT_RECOGNITION` — debit Expense, credit Prepayments
- `DEPRECIATION` — debit Depreciation Expense, credit Accumulated Depreciation
- `FX_REVALUATION` — adjust balances for exchange rate movements
- `YEAR_END_CLOSE` — zero out P&L accounts to Retained Earnings

Each transaction type has a default account mapping stored in `transaction_type_mappings`. The mapping is configurable. When the posting engine expands a business transaction into double-entry lines, it looks up the mapping for that type.

**Account mapping configuration structure:**

```typescript
interface TransactionTypeMapping {
  transaction_type: string;
  debit_rules: MappingRule[];
  credit_rules: MappingRule[];
}

interface MappingRule {
  account_code: string;        // default account
  amount_source: 'net' | 'tax' | 'gross';  // which amount from the input line
  description_template: string; // e.g., "Trade debtors - {counterparty}"
  allow_override: boolean;      // whether the submitting module can override
}
```

## Multi-Currency — Detailed Specification

### Core Concepts

Each instance has a **base currency** (configured in the `company_settings` table, e.g., GBP for a UK business). All reporting is in the base currency. Transactions can be submitted in any currency.

### Currency on Transactions

When a transaction is submitted with a currency different from the base currency:

1. The API request MUST include an `exchange_rate` field.
2. The exchange rate means: `1 unit of transaction currency = exchange_rate units of base currency`. Example: if EUR/GBP rate is 0.86, then `exchange_rate: "0.86"` means 1 EUR = 0.86 GBP.
3. The posting engine computes base currency amounts for every line by multiplying the transaction currency amount by the exchange rate.
4. Both sets of amounts are validated independently (debits = credits in transaction currency AND in base currency).
5. Both sets are written to the chain file and the database.

### FX Revaluation

At period end, foreign-currency balances (e.g., a EUR debtor account) must be revalued to the current exchange rate. This generates `FX_REVALUATION` transactions:

```typescript
// In src/engine/currency.ts
async function generateFxRevaluations(
  periodId: string,
  closingRates: Record<string, string>  // currency -> rate
): Promise<RevaluationEntry[]> {
  // 1. Find all accounts with non-zero balances in non-base currencies
  // 2. For each: compute the difference between the recorded base-currency
  //    balance and the balance at the new rate
  // 3. Generate an FX_REVALUATION transaction for each difference
  // 4. Debit/credit the account, contra to FX Gain/Loss account
}
```

### Exchange Rate Storage

The `exchange_rates` table stores historical rates. The most recent rate for a currency pair on or before a given date is used by default. Modules can override by providing an explicit rate on each transaction.

## Approval Workflow — V1 Enhancements

### Delegation

An approver can delegate their authority to another user for a specified period:

```typescript
interface ApprovalDelegation {
  delegator_id: string;
  delegate_id: string;
  valid_from: Date;
  valid_until: Date;
  scope?: {
    transaction_types?: string[];     // limit to certain types
    max_amount?: string;              // limit delegated amount authority
  };
}
```

When checking who can approve a transaction, the system looks up active delegations and treats the delegate as having the delegator's authority within the delegation scope.

### Escalation

Transactions sitting in the approval queue longer than a configurable threshold (default: 48 hours) are escalated. Escalation logic:

1. Query all staging entries with `status = 'PENDING'` and `created_at < NOW() - escalation_threshold`.
2. For each, look up the escalation chain: if the required approver has a manager defined, re-assign to the manager.
3. If no escalation target exists, mark the entry as `ESCALATED` and trigger a webhook event.

### Multi-Level Approval

High-value transactions can require sign-off from multiple approvers. The approval rules can specify:

```typescript
interface ApprovalRule {
  // ... existing fields from MVP ...
  required_approvals: number;   // default 1, can be 2+ for multi-level
  approval_roles: string[];     // which roles can approve
}
```

The staging entry tracks partial approvals:

```sql
ALTER TABLE staging ADD COLUMN approvals JSONB DEFAULT '[]';
-- Each approval: { "approved_by": "user@co.com", "approved_at": "...", "notes": "..." }
```

The transaction only moves from staging to the chain when `approvals.length >= required_approvals`.

### Segregation of Duties

The GL enforces that certain transaction combinations cannot be approved by the same person. For example, the person who raised a purchase order cannot approve the corresponding supplier invoice.

Implementation: when evaluating an approval action, the engine checks the `correlation_id` to find related transactions. If the approver is the same person who submitted any related transaction, the approval is rejected with error `SEGREGATION_OF_DUTIES_VIOLATION`.

## Webhook Event Publishing

### Event Types

The GL publishes these events:

- `TRANSACTION_POSTED` — a transaction was committed to the chain
- `TRANSACTION_APPROVED` — a staged transaction was approved
- `TRANSACTION_REJECTED` — a staged transaction was rejected
- `PERIOD_SOFT_CLOSED` — a period entered soft close
- `PERIOD_CLOSED` — a period was hard closed
- `APPROVAL_ESCALATED` — a pending approval was escalated

### Delivery Mechanism

```typescript
// In src/engine/webhooks.ts

async function publishEvent(eventType: string, payload: object): Promise<void> {
  // 1. Find all active webhook subscriptions for this event type
  // 2. For each subscription:
  //    a. Create a webhook_deliveries record with status 'PENDING'
  //    b. Sign the payload with the subscription's HMAC secret
  //    c. Send HTTP POST to the callback URL with:
  //       - Header: X-GL-Signature: sha256=<hmac>
  //       - Header: X-GL-Event: <event_type>
  //       - Body: JSON payload
  //    d. If response is 2xx, update delivery status to 'DELIVERED'
  //    e. If response is non-2xx or timeout, update to 'RETRYING'
  // 3. Retries: exponential backoff (1min, 5min, 30min, 2hr, 12hr)
  // 4. After 5 failed attempts, update to 'FAILED' and increment subscription failure_count
  // 5. If a subscription has failure_count > 10, deactivate it
}
```

**IMPORTANT:** Webhook delivery MUST be asynchronous. The posting API must not wait for webhook delivery. Use a background job queue (a simple in-process setImmediate/setTimeout queue for V1; a proper job queue like BullMQ is a future enhancement).

### Webhook Payload Structure

```json
{
  "event_id": "evt-uuid-here",
  "event_type": "TRANSACTION_POSTED",
  "timestamp": "2026-03-04T10:30:00.000Z",
  "data": {
    "transaction_id": "TXN-2026-03-00001",
    "transaction_type": "CUSTOMER_INVOICE",
    "reference": "INV-2026-00142",
    "period": "2026-03",
    "total_amount": "46200.00",
    "currency": "GBP",
    "chain_hash": "e92d1f44b7...2203"
  }
}
```

## REST API — V1 Endpoints

All endpoints are prefixed with `/api/v1/gl/`. All require authentication (JWT Bearer token).

### Transaction Endpoints

**POST /api/v1/gl/transactions** — Submit a single transaction for posting.

Request body: the full transaction submission as described in the architecture document (Section 2.6). V1 additions: `currency`, `exchange_rate`, `module_signature` fields.

Response: `{ "status": "POSTED", "transaction_id": "...", ... }` or `{ "status": "AWAITING_APPROVAL", "staging_id": "...", ... }` or `{ "status": "REJECTED", "error_code": "...", ... }`.

**POST /api/v1/gl/transactions/bulk** — Submit multiple transactions in a batch.

Request body:
```json
{
  "transactions": [
    { /* transaction 1 */ },
    { /* transaction 2 */ }
  ]
}
```

Response: array of individual results, keyed by idempotency_key. Each transaction is processed independently — a failure on one does not roll back others.

```json
{
  "results": [
    { "idempotency_key": "key-1", "status": "POSTED", "transaction_id": "..." },
    { "idempotency_key": "key-2", "status": "REJECTED", "error_code": "ACCOUNT_NOT_FOUND", "message": "..." }
  ],
  "summary": { "total": 2, "posted": 1, "awaiting_approval": 0, "rejected": 1 }
}
```

**GET /api/v1/gl/transactions** — Query committed transactions.

Query parameters: `period`, `date_from`, `date_to`, `transaction_type`, `account_code`, `counterparty_trading_account_id`, `counterparty_contact_id`, `source_module`, `correlation_id`, `reference`, `amount_min`, `amount_max`, `currency`, `page`, `page_size`, `sort_by`, `sort_order`.

**GET /api/v1/gl/transactions/:id** — Get a single transaction with full detail including all posting lines, approval history, and chain metadata.

### Account Endpoints

**GET /api/v1/gl/accounts** — List chart of accounts. Query params: `category`, `type`, `active_only`, `search`.

**POST /api/v1/gl/accounts** — Create a new account.

**PUT /api/v1/gl/accounts/:code** — Update an account (name, category, active flag).

**GET /api/v1/gl/accounts/:code/balance** — Get account balance. Query params: `as_at_date`, `period`, `currency`.

**GET /api/v1/gl/accounts/:code/ledger** — Get account ledger (all transactions for this account). Query params: `date_from`, `date_to`, `period`, `page`, `page_size`.

### Period Endpoints

**GET /api/v1/gl/periods** — List all periods with status and data_flag.

**GET /api/v1/gl/periods/current** — Get the current open period.

**GET /api/v1/gl/periods/:id/status** — Get detailed status of a specific period.

**POST /api/v1/gl/periods/:id/soft-close** — Initiate soft close.

**POST /api/v1/gl/periods/:id/close** — Initiate hard close. Returns the closing checklist result and the PERIOD_CLOSE chain entry details.

### Approval Endpoints

**GET /api/v1/gl/approvals/pending** — List transactions awaiting approval. Query params: `transaction_type`, `amount_min`, `amount_max`, `source_module`, `sort_by`.

**GET /api/v1/gl/approvals/:staging_id** — Full detail on a pending item.

**POST /api/v1/gl/approvals/:staging_id/approve** — Approve a pending transaction. Body: `{ "notes": "optional" }`.

**POST /api/v1/gl/approvals/:staging_id/reject** — Reject with reason. Body: `{ "reason": "required" }`.

**POST /api/v1/gl/approvals/bulk-approve** — Approve multiple items. Body: `{ "staging_ids": ["id1", "id2"], "notes": "optional" }`.

### Report Endpoints

**GET /api/v1/gl/reports/trial-balance** — Trial balance. Query params: `period`, `as_at_date`, `include_comparatives`.

Response includes: account code, account name, category, debit balance, credit balance, data_flag (PROVISIONAL/AUTHORITATIVE). If `include_comparatives=true`, includes prior period and same period last year.

**GET /api/v1/gl/reports/profit-and-loss** — Profit and loss statement. Query params: `period`, `date_from`, `date_to`, `comparative_period`, `cost_centre`, `department`, `format` (summary/detailed).

**GET /api/v1/gl/reports/balance-sheet** — Balance sheet. Query params: `as_at_date`, `period`, `comparative_period`.

**GET /api/v1/gl/reports/cash-flow** — Cash flow statement. Query params: `period`, `method` (direct/indirect).

### Chain Verification Endpoints

**GET /api/v1/gl/chain/verify** — Run hash chain verification for a period. Query param: `period`. Returns: `{ valid: boolean, entries: number, merkle_valid: boolean, error?: string }`.

**GET /api/v1/gl/chain/checkpoint/:period** — Retrieve the checkpoint hash and Merkle root for a closed period.

**GET /api/v1/gl/chain/proof/:transaction_id** — Generate a Merkle proof for a specific transaction. Returns the proof path so an external verifier can confirm the transaction is in the chain.

### Transaction Type Discovery Endpoint

**GET /api/v1/gl/transaction-types** — Self-documenting catalogue of supported transaction types.

Response:
```json
{
  "transaction_types": [
    {
      "code": "CUSTOMER_INVOICE",
      "description": "Record a sale to a customer",
      "category": "SALES_AND_RECEIVABLES",
      "required_fields": ["reference", "date", "counterparty", "lines"],
      "optional_fields": ["currency", "exchange_rate", "approval_context"],
      "line_fields": {
        "required": ["description", "net_amount", "tax_code", "tax_amount"],
        "optional": ["account_override", "cost_centre", "department", "dimensions"]
      },
      "default_postings": {
        "debit": [{ "account": "1100-TRADE_DEBTORS", "amount_source": "gross" }],
        "credit": [
          { "account": "4000-SALES_TRADE", "amount_source": "net" },
          { "account": "2100-VAT_OUTPUT", "amount_source": "tax" }
        ]
      }
    }
  ]
}
```

### Webhook Management Endpoints

**POST /api/v1/gl/webhooks** — Register a new webhook subscription. Body: `{ "callback_url": "...", "event_types": [...], "secret": "..." }`.

**GET /api/v1/gl/webhooks** — List webhook subscriptions.

**DELETE /api/v1/gl/webhooks/:id** — Remove a subscription.

**GET /api/v1/gl/webhooks/:id/deliveries** — View delivery history for a subscription.

### Sub-Ledger Reconciliation Endpoint

**POST /api/v1/gl/reconciliations** — Submit a sub-ledger reconciliation confirmation from an external module. Body:

```json
{
  "period_id": "2026-03",
  "module_id": "sales-and-customer",
  "control_account": "1100-TRADE_DEBTORS",
  "module_balance": "12400.00",
  "gl_balance": "12400.00",
  "is_reconciled": true,
  "notes": null
}
```

This data is checked during the hard-close process.

## Period Management and Closing — V1 Specification

The V1 closing process adds Merkle root computation and sub-ledger reconciliation checks to the MVP closing sequence.

### Hard Close Steps (V1)

1. Verify the period exists and its current status is `SOFT_CLOSE`. If not, throw `InvalidPeriodStateError`.
2. **Sequential ordering check**: Find the previous period. If it exists and is not `HARD_CLOSE`, throw `PeriodSequenceError`.
3. **Staging area check**: Count pending entries. If any exist, throw `StagingNotClearError`.
4. **Trial balance check**: Verify total debits = total credits. If not, throw `TrialBalanceError`.
5. **Sub-ledger reconciliation check (NEW)**: For each registered module that has the current period's transaction types, check that a reconciliation confirmation has been received. If any are missing, return a warning (not a hard failure — the user can override).
6. **Compute closing trial balance**: For every account with activity, compute the closing balance.
7. **Compute Merkle root**: Build the Merkle tree from all TRANSACTION entries and compute the root.
8. **Write PERIOD_CLOSE entry**: Call `chainWriter.sealPeriod()` with the closing payload (including Merkle root and reconciliation status).
9. **Update the database**: Set period status, data_flag, closing_chain_hash, merkle_root.
10. **Create the next period**: Compute opening balances (balance sheet accounts carry forward, P&L accounts reset to zero).
11. **Year-end close** (if applicable): Generate YEAR_END_CLOSE transaction.
12. **Publish webhook events**: `PERIOD_CLOSED` event to all subscribers.
13. Return the closed period with closing details.

### Custom Error Classes

All the MVP error classes remain. V1 adds:

```typescript
class InvalidModuleSignatureError extends Error {
  constructor(moduleId: string) {
    super(`Invalid digital signature from module ${moduleId}`);
  }
}

class SegregationOfDutiesError extends Error {
  constructor(userId: string, relatedTransactionId: string) {
    super(`User ${userId} cannot approve: also submitted related transaction ${relatedTransactionId}`);
  }
}

class ExchangeRateRequiredError extends Error {
  constructor(currency: string, baseCurrency: string) {
    super(`Exchange rate required for ${currency} to ${baseCurrency} conversion`);
  }
}

class CurrencyMismatchError extends Error {
  constructor(expected: string, received: string) {
    super(`Currency mismatch: expected ${expected}, received ${received}`);
  }
}
```

## Advanced Reporting — V1

### Profit and Loss (Income Statement)

The P&L report queries transaction_lines for REVENUE and EXPENSE accounts within a date range. Structure:

```
Revenue
  Sales Revenue — Trade        38,500.00
  Sales Revenue — Other         2,100.00
  ─────────────────────────────────────
  Total Revenue                40,600.00

Cost of Sales
  Cost of Goods Sold           18,200.00
  Purchases — Raw Materials     5,400.00
  ─────────────────────────────────────
  Total Cost of Sales          23,600.00

  GROSS PROFIT                 17,000.00

Overheads
  Wages and Salaries            6,000.00
  Rent and Rates                1,200.00
  Office Supplies                 350.00
  ...
  ─────────────────────────────────────
  Total Overheads               8,750.00

  NET PROFIT                    8,250.00
```

Implementation in `src/engine/reports.ts`:

```typescript
interface ProfitAndLossReport {
  period: string;
  date_from: string;
  date_to: string;
  data_flag: 'PROVISIONAL' | 'AUTHORITATIVE';
  sections: PnLSection[];
  gross_profit: string;
  total_overheads: string;
  net_profit: string;
  comparative?: ProfitAndLossReport;  // prior period for comparison
}

interface PnLSection {
  name: string;
  category: string;
  accounts: PnLAccountLine[];
  total: string;
}
```

The query groups transaction_lines by account category (REVENUE, DIRECT_COSTS, OVERHEADS, FINANCE_COSTS, OTHER_INCOME), sums debit and credit for each account, and computes net amounts.

### Balance Sheet

The balance sheet shows the position at a point in time. For open periods, running balances include all transactions up to the report date. For closed periods, the closing trial balance is used.

```
ASSETS
  Current Assets
    Bank Current Account       15,420.50
    Trade Debtors              12,400.00
    VAT Input                   1,800.00
    ─────────────────────────────────────
    Total Current Assets       29,620.50

LIABILITIES
  Current Liabilities
    Trade Creditors             5,320.00
    VAT Output                  3,400.00
    ─────────────────────────────────────
    Total Current Liabilities   8,720.00

EQUITY
  Share Capital                 1,000.00
  Retained Earnings            19,900.50
  ─────────────────────────────────────
  Total Equity                 20,900.50

TOTAL LIABILITIES + EQUITY    29,620.50
```

### Cash Flow Statement

The cash flow statement is derived from transaction data. For V1, implement the **indirect method**:

1. Start with net profit (from P&L).
2. Adjust for non-cash items (depreciation, revaluations).
3. Adjust for working capital changes (change in debtors, creditors, stock).
4. Show investing activities (fixed asset purchases/disposals).
5. Show financing activities (loans, equity).

```typescript
interface CashFlowReport {
  period: string;
  data_flag: 'PROVISIONAL' | 'AUTHORITATIVE';
  operating_activities: {
    net_profit: string;
    adjustments: CashFlowAdjustment[];
    working_capital_changes: CashFlowAdjustment[];
    net_cash_from_operations: string;
  };
  investing_activities: {
    items: CashFlowItem[];
    net_cash_from_investing: string;
  };
  financing_activities: {
    items: CashFlowItem[];
    net_cash_from_financing: string;
  };
  net_change_in_cash: string;
  opening_cash: string;
  closing_cash: string;
}
```

## MCP Server — Overview

See `docs/MCP_SERVER_SPEC.md` for the full MCP server specification.

The MCP server is built using `@modelcontextprotocol/sdk` and runs as a separate process communicating via stdio transport. It exposes GL operations as MCP tools and GL reference data as MCP resources.

**Key tools:**
- `gl_post_transaction` — submit a transaction
- `gl_query_journal` — search transactions
- `gl_get_trial_balance` — get trial balance
- `gl_get_account_balance` — get account balance
- `gl_list_accounts` — browse chart of accounts
- `gl_get_period_status` — check period status
- `gl_approve_transaction` — approve a pending transaction
- `gl_reject_transaction` — reject a pending transaction
- `gl_verify_chain` — verify chain integrity

**Key resources:**
- `gl://accounts` — the full chart of accounts
- `gl://periods` — current period information
- `gl://transaction-types` — catalogue of supported types
- `gl://approval-queue` — current pending approvals

The MCP server calls the same engine layer functions as the REST API handlers. It shares the same validation, approval workflow, and audit trail.

## Web Frontend — V1 Enhancements

### New Pages

**Profit and Loss page** — Period selector, P&L report with configurable grouping, comparative columns (prior period, prior year), drill-down to account ledger on any line, export to PDF/XLSX.

**Balance Sheet page** — Date selector, standard balance sheet format, comparative column, drill-down capability, export.

**Cash Flow page** — Period selector, indirect method format, export.

**Audit Trail page** — Browse the hash chain for any period. Show each entry's hash, predecessor hash, chain integrity status. Verify individual transactions with Merkle proof display. Run full chain verification with progress indicator.

**Webhook Management page** — List subscriptions, add/remove subscriptions, view delivery history, retry failed deliveries.

### Enhanced Existing Pages

**Dashboard** — Add currency summary (balances by currency), webhook delivery status, chain verification status indicator.

**Approval Queue** — Add keyboard shortcuts (A=approve, R=reject, arrow keys to navigate), batch operations (select multiple, approve all / reject all), delegation management, escalation indicators, confidence score display.

**Journal** — Add currency filter, correlation ID grouping (show related transactions together), module signature verification indicator.

**Trial Balance** — Add currency selector (view in base or transaction currency), comparative periods, budget columns.

**Period Management** — Add sub-ledger reconciliation status checklist, Merkle root display for closed periods.

### UI Design Principles

These apply to ALL frontend work:

1. **Information density** — accounting interfaces should show substantial data. Clean tables, good vertical alignment, many rows visible.
2. **Numeric formatting** — monospaced numerals aligned on decimal point. Debit and credit in separate columns. Thousands separators. Currency symbols.
3. **Keyboard navigation** — fully keyboard-navigable. Tab order follows workflow. Shortcuts for common actions.
4. **Professional tone** — restrained colour use. Red for imbalances, amber for pending, green for balanced/approved. No decorative animation.
5. **Desktop-first** — optimise for wide screens. Side-by-side views where useful (journal + document, approval + context).

## Sample Chart of Accounts (for seeding)

```
1000  Bank Current Account          ASSET / CURRENT_ASSET
1050  Bank Deposit Account          ASSET / CURRENT_ASSET
1100  Trade Debtors                 ASSET / CURRENT_ASSET
1150  Other Debtors                 ASSET / CURRENT_ASSET
1200  VAT Input (Recoverable)       ASSET / CURRENT_ASSET
1300  Stock                         ASSET / CURRENT_ASSET
1350  Goods Received Not Invoiced   ASSET / CURRENT_ASSET
1400  Prepayments                   ASSET / CURRENT_ASSET
1500  Fixed Assets — Cost           ASSET / FIXED_ASSET
1510  Fixed Assets — Accum Depn     ASSET / FIXED_ASSET
2000  Trade Creditors               LIABILITY / CURRENT_LIABILITY
2050  Other Creditors               LIABILITY / CURRENT_LIABILITY
2100  VAT Output                    LIABILITY / CURRENT_LIABILITY
2150  Accruals                      LIABILITY / CURRENT_LIABILITY
2200  PAYE/NI Payable               LIABILITY / CURRENT_LIABILITY
3000  Share Capital                 EQUITY
3100  Retained Earnings             EQUITY
3200  Revaluation Reserve           EQUITY
4000  Sales Revenue — Trade         REVENUE
4100  Sales Revenue — Other         REVENUE
4200  Other Income                  REVENUE / OTHER_INCOME
5000  Cost of Goods Sold            EXPENSE / DIRECT_COSTS
5100  Purchases — Raw Materials     EXPENSE / DIRECT_COSTS
5200  Purchase Price Variance       EXPENSE / DIRECT_COSTS
6000  Wages and Salaries            EXPENSE / OVERHEADS
6100  Rent and Rates                EXPENSE / OVERHEADS
6200  Office Supplies               EXPENSE / OVERHEADS
6300  Professional Fees             EXPENSE / OVERHEADS
6400  Travel and Subsistence        EXPENSE / OVERHEADS
6500  Marketing and Advertising     EXPENSE / OVERHEADS
6600  Depreciation                  EXPENSE / OVERHEADS
6700  Bad Debts                     EXPENSE / OVERHEADS
6800  Stock Write-Off               EXPENSE / OVERHEADS
7000  Bank Interest Received        REVENUE / OTHER_INCOME
7100  Bank Charges                  EXPENSE / FINANCE_COSTS
7200  FX Gains / Losses             EXPENSE / FINANCE_COSTS
```

## Commands

```bash
# Start the full stack locally
docker-compose up

# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests (requires database)
npm run test:integration

# Run database migrations
npm run migrate

# Seed the database with sample data
npm run seed

# Build the frontend
cd src/web && npm run build

# Type check without building
npm run typecheck

# Start the MCP server (stdio transport, for testing)
npm run mcp

# Run MCP integration tests
npm run test:mcp
```

## Code Style

- Use TypeScript strict mode throughout.
- Prefer explicit types over `any`. Never use `any` in the engine, chain, or MCP layers.
- Use `Decimal.js` for ALL monetary calculations — never use JavaScript floating point for money. Store monetary values as strings in JSON payloads.
- Error handling: use the custom error classes defined above rather than generic errors.
- All API responses follow a consistent envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`.
- Database queries go in `src/db/queries/`, not in API handlers or engine code.
- All dates are ISO 8601 strings. All timestamps are UTC.
- Use meaningful variable names. Accounting terminology: debit, credit, ledger, journal, trial balance.
- MCP tool handlers must be thin wrappers around engine functions. No business logic in MCP handlers.

## Testing Philosophy

- **Chain integrity tests are the most important tests.** Every test that writes to the chain must verify the hash chain is unbroken afterwards.
- **Every posting test must verify debits equal credits** in both transaction currency AND base currency.
- **Period closing tests must verify closed periods reject new postings.**
- **Multi-currency tests must verify dual-amount recording and FX revaluation.**
- **Merkle tree tests must verify proof generation and verification.**
- **MCP tool tests must verify the same outcomes as equivalent REST API tests.**
- **Webhook tests must verify event publishing and retry logic.**
- **Integration tests use a real PostgreSQL database** (Docker Compose) — not mocks.
- Write tests alongside implementation, not as an afterthought.

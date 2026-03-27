# GL V1 Build Prompts — Sequential Instructions for Claude Code Sonnet

## How to Use This File

Give Claude Code these prompts **in sequence**. Wait for each one to complete and verify it works before moving to the next. Each prompt builds on the previous work.

These prompts assume the MVP codebase is already built and working. If it is not, build the MVP first using the gl-mvp/GETTING_STARTED.md prompts.

After each prompt completes, commit your work using GitHub Desktop before moving to the next prompt.

---

## Prompt 1 — V1 Database Migrations (Multi-Currency, New Tables)

```
Read the CLAUDE.md file thoroughly — it contains the complete V1 specification. Then create new database migration files (do NOT modify existing MVP migrations) that add V1 capabilities to the schema.

Create these migration files in src/db/migrations/ with timestamps after the existing MVP migrations:

Migration 1 — "add_multicurrency_columns":
- Add to transactions: currency VARCHAR(3) NOT NULL DEFAULT 'GBP', exchange_rate NUMERIC(19,8), base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP'.
- Add to transaction_lines: base_debit NUMERIC(19,4) NOT NULL DEFAULT 0, base_credit NUMERIC(19,4) NOT NULL DEFAULT 0.
- Add to staging: currency VARCHAR(3) NOT NULL DEFAULT 'GBP', exchange_rate NUMERIC(19,8).

Migration 2 — "add_chain_v1_columns":
- Add to transactions: module_signature JSONB, merkle_index INTEGER.
- Add to periods: merkle_root VARCHAR(64), sub_ledger_reconciliations JSONB.

Migration 3 — "create_v1_tables":
- Create company_settings table: id INTEGER PRIMARY KEY DEFAULT 1, company_name VARCHAR(255) NOT NULL DEFAULT 'My Company', base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP', financial_year_start_month INTEGER NOT NULL DEFAULT 4 (April for UK), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), settings JSONB NOT NULL DEFAULT '{}'. This is a single-row table — the CHECK constraint `id = 1` ensures only one row can ever exist. This replaces the old tenants table. All company-wide configuration (base currency, financial year, etc.) is stored here.
- Create registered_modules table: module_id VARCHAR(100) PRIMARY KEY, display_name VARCHAR(255) NOT NULL, public_key TEXT, allowed_transaction_types TEXT[] NOT NULL, is_active BOOLEAN DEFAULT true, registered_at TIMESTAMPTZ DEFAULT NOW().
- Create webhook_subscriptions table: id UUID PRIMARY KEY DEFAULT gen_random_uuid(), callback_url TEXT NOT NULL, event_types TEXT[] NOT NULL, secret VARCHAR(255) NOT NULL, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), last_delivery_at TIMESTAMPTZ, failure_count INTEGER DEFAULT 0.
- Create webhook_deliveries table: id UUID PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id UUID REFERENCES webhook_subscriptions(id), event_type VARCHAR(100) NOT NULL, payload JSONB NOT NULL, status VARCHAR(20) NOT NULL, attempts INTEGER DEFAULT 0, last_attempt_at TIMESTAMPTZ, last_response_status INTEGER, last_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW().
- Create approval_delegations table: id UUID PRIMARY KEY DEFAULT gen_random_uuid(), delegator_id VARCHAR(255) NOT NULL, delegate_id VARCHAR(255) NOT NULL, valid_from TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ NOT NULL, scope JSONB, created_at TIMESTAMPTZ DEFAULT NOW().
- Create exchange_rates table: id UUID PRIMARY KEY DEFAULT gen_random_uuid(), from_currency VARCHAR(3) NOT NULL, to_currency VARCHAR(3) NOT NULL, rate NUMERIC(19,8) NOT NULL, effective_date DATE NOT NULL, source VARCHAR(100), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(from_currency, to_currency, effective_date).
- Create sub_ledger_reconciliations table: id UUID PRIMARY KEY DEFAULT gen_random_uuid(), period_id VARCHAR(10) NOT NULL, module_id VARCHAR(100) NOT NULL, control_account VARCHAR(20) NOT NULL, module_balance NUMERIC(19,4) NOT NULL, gl_balance NUMERIC(19,4) NOT NULL, is_reconciled BOOLEAN NOT NULL, confirmed_at TIMESTAMPTZ DEFAULT NOW(), notes TEXT.
- Add indexes as specified in the CLAUDE.md "Index Strategy" section.

Update the seed file to:
- Insert the default company_settings row: id=1, company_name='My Company', base_currency='GBP', financial_year_start_month=4.
- Register a default module: module_id='general-ledger', display_name='General Ledger', allowed_transaction_types for all types, public_key=null.
- Add the new V1 chart of accounts entries (accounts 1050, 1150, 1300, 1350, 1400, 1500, 1510, 2050, 2150, 3200, 4200, 5200, 6700, 6800, 7200) to the existing seed.
- Add transaction type mappings for ALL V1 transaction types listed in CLAUDE.md.

Also create src/db/queries/company_settings.ts with functions:
- getCompanySettings(): returns the single row from company_settings. Cache this in memory after first read — it rarely changes.
- updateCompanySettings(updates: { company_name?, base_currency?, financial_year_start_month?, settings? }): updates the single row. Clear the in-memory cache after update.
- getBaseCurrency(): convenience function that returns the base_currency string from getCompanySettings().

Run the migrations and seeds against the local database. Run existing tests to verify nothing is broken.
```

---

## Prompt 2 — Single-Tenant Architecture

**Note: Prompt 2 (Multi-Tenancy) has been removed.** This platform uses a single-tenant architecture — one instance per company. There is no tenant_id, no tenant resolution middleware, and no tenant-scoped queries. All database queries and chain file operations serve the single company that owns the instance. The prompt numbering is preserved for reference continuity.

---

## Prompt 3 — Multi-Currency Support

```
Read CLAUDE.md sections on multi-currency. Implement multi-currency transaction support.

Step 1 — Currency types and utilities (src/engine/currency.ts):
- Create a CurrencyAmount type: { amount: Decimal, currency: string }.
- Create a function getBaseCurrencyForInstance(): reads the base_currency from the company_settings table using the getBaseCurrency() function created in Prompt 1 (src/db/queries/company_settings.ts). This is the instance's base currency (e.g., GBP for a UK business). Use this wherever the code needs to know the base currency — never hardcode 'GBP'.
- Create a function convertToBaseCurrency(amount: Decimal, exchangeRate: Decimal): Decimal that multiplies amount by exchangeRate and rounds to 4 decimal places.
- Create a function validateExchangeRate(currency: string, baseCurrency: string, exchangeRate: string | null): validates that: if currency equals baseCurrency, exchangeRate is either null or "1"; if currency differs from baseCurrency, exchangeRate is required and must be a positive number. Throws ExchangeRateRequiredError or CurrencyMismatchError if invalid.

Step 2 — Update the posting engine (src/engine/posting.ts):
- When expanding a transaction into posting lines, if the transaction has a non-base currency:
  a. Validate the exchange rate.
  b. For each posting line, compute base_debit and base_credit by multiplying debit/credit by the exchange rate.
  c. Validate that BOTH transaction-currency totals balance (sum of debits = sum of credits) AND base-currency totals balance.
  d. Store both sets of amounts on the chain entry and in the database.
- When currency equals base currency, set base_debit = debit and base_credit = credit.

Step 3 — Update the chain entry payload structure:
- Each line in the chain entry now has 4 amount fields: debit, credit, base_debit, base_credit.
- All stored as strings (not numbers) to preserve decimal precision.
- The transaction header includes currency, exchange_rate, and base_currency.

Step 4 — Update database writes (src/db/queries/transactions.ts):
- When inserting transaction_lines, include base_debit and base_credit columns.
- When inserting transactions, include currency, exchange_rate, base_currency columns.

Step 5 — Exchange rate management:
- Create src/db/queries/exchange_rates.ts with functions:
  - setRate(fromCurrency, toCurrency, rate, effectiveDate, source): inserts or updates a rate.
  - getRate(fromCurrency, toCurrency, date): returns the most recent rate on or before the given date.
  - getRates(date): returns all rates effective on the given date.
- Create API endpoints:
  - POST /api/v1/gl/exchange-rates — set a rate. Body: { from_currency, to_currency, rate, effective_date, source }.
  - GET /api/v1/gl/exchange-rates — list rates. Query params: from_currency, to_currency, date.

Step 6 — FX Revaluation engine (src/engine/currency.ts):
- Create function generateFxRevaluations(periodId, closingRates):
  a. Query all accounts that have transaction_lines with currency != base_currency.
  b. For each such account, compute: the recorded base-currency balance (sum of base_debit - base_credit), and the revalued balance (sum of foreign-currency amounts * new closing rate).
  c. If there's a difference, generate an FX_REVALUATION transaction: debit/credit the account for the difference, contra to account 7200-FX_GAINS_LOSSES.
  d. Return the array of revaluation transactions.
- These transactions should be posted through the normal posting engine (so they go through the chain and get the full audit trail).

Step 7 — Write tests:
- Test posting a EUR transaction when base currency is GBP: verify both EUR and GBP amounts are stored correctly.
- Test posting a GBP transaction (same as base): verify base amounts equal transaction amounts.
- Test that a foreign-currency transaction without exchange_rate is rejected.
- Test FX revaluation: post a EUR transaction at rate 0.86, then run revaluation at rate 0.88, verify the revaluation transaction is correct.
- Test that both currency sets balance independently.

Run all tests.
```

---

## Prompt 4 — Merkle Tree Implementation

```
Read CLAUDE.md sections on Merkle tree. Implement the Merkle tree for chain integrity.

Create src/chain/merkle.ts with these functions:

1. buildMerkleTree(entryHashes: string[]): MerkleTree
   - Takes an array of entry hashes (the entry_hash values of TRANSACTION entries in a period).
   - If the array is empty, return a tree with root hash of all zeros (64 hex chars).
   - If the array has 1 entry, the root is that entry's hash.
   - Otherwise: pair up adjacent hashes. For each pair, sort them lexicographically (to ensure determinism), concatenate, and SHA-256 hash the result. If there's an odd number, duplicate the last hash.
   - Repeat until there's one root hash.
   - Store all intermediate nodes for proof generation.
   - Return the complete MerkleTree structure.

2. getMerkleRoot(entryHashes: string[]): string
   - Convenience function. Builds the tree and returns just the root hash.

3. generateProof(tree: MerkleTree, leafIndex: number): MerkleProof
   - For the given leaf, walk up the tree and collect the sibling hash at each level.
   - Each proof step records: the sibling hash and whether it was on the 'left' or 'right'.
   - Return: { leaf_hash, leaf_index, proof_path, merkle_root }.

4. verifyProof(proof: MerkleProof): boolean
   - Start with the leaf_hash.
   - For each step in the proof path: combine the current hash with the sibling hash (ordered by position — if sibling is 'left', it goes first; if 'right', current hash goes first). Sort lexicographically, concatenate, hash.
   - After processing all steps, compare the result with merkle_root.
   - Return true if they match, false otherwise.

Types to define:

```typescript
interface MerkleTree {
  root: string;
  leaves: string[];
  levels: string[][];  // levels[0] = leaves, levels[last] = [root]
}

interface MerkleProof {
  leaf_hash: string;
  leaf_index: number;
  proof_path: MerkleProofStep[];
  merkle_root: string;
}

interface MerkleProofStep {
  hash: string;
  position: 'left' | 'right';
}
```

Now update the chain writer and reader:

5. In writer.ts — appendEntry():
   - When appending a TRANSACTION entry, set merkle_position to { index: <count of previous TRANSACTION entries>, depth: 0 }.
   - For GENESIS and PERIOD_CLOSE entries, merkle_position is null.

6. In writer.ts — sealPeriod():
   - Before writing the PERIOD_CLOSE entry, read all TRANSACTION entries from the file, collect their entry_hashes, and call getMerkleRoot().
   - Include the merkle_root in the PERIOD_CLOSE payload.

7. In reader.ts — verifyChain():
   - After verifying the hash chain, if the last entry is PERIOD_CLOSE with a merkle_root, also verify the Merkle root by rebuilding it from TRANSACTION entry hashes. Report merkle_valid in the result.

8. In reader.ts — new function getMerkleProof():
   - Read all TRANSACTION entries for the period.
   - Build the Merkle tree.
   - Find the specified transaction by sequence number or transaction_id.
   - Generate and return the proof.

Write comprehensive tests:

- Build a tree with 1, 2, 3, 7, 16, and 100 entries. Verify the root is deterministic (same inputs always produce same root).
- Generate proofs for various leaf positions. Verify each proof.
- Tamper with a leaf hash in the proof and verify that verification fails.
- Tamper with a sibling hash in the proof path and verify failure.
- Test the empty tree case (0 entries).
- Test that the Merkle root in a PERIOD_CLOSE entry matches a freshly computed root.
- Integration test: post 10 transactions, close the period, verify the Merkle root, then generate and verify proofs for transactions 1, 5, and 10.

Run all tests.
```

---

## Prompt 5 — Digital Signatures

```
Read CLAUDE.md sections on digital signatures. Implement module signature verification.

Create src/chain/signatures.ts:

1. Create types:

```typescript
interface ModuleSignature {
  module_id: string;
  algorithm: 'Ed25519';
  signature: string;  // base64-encoded
  public_key_fingerprint: string;  // sha256 of the public key
}
```

2. Create function verifyModuleSignature(payload: object, signature: ModuleSignature, registeredPublicKey: Buffer): boolean
   - Compute the canonical JSON of the payload (using the same canonicalStringify from hash.ts).
   - Use Node.js crypto.verify() with algorithm null (Ed25519 doesn't use a separate hash), the canonical JSON as the data, the public key, and the decoded signature.
   - Return true if valid, false if not.

3. Create function computePublicKeyFingerprint(publicKey: Buffer): string
   - SHA-256 hash the public key bytes, return as lowercase hex.

4. Create function generateTestKeyPair(): { publicKey: Buffer, privateKey: Buffer }
   - Use crypto.generateKeyPairSync('ed25519') to generate a test key pair.
   - Return both keys in DER format.

5. Create function signPayload(payload: object, privateKey: Buffer): string
   - Compute canonical JSON of the payload.
   - Sign with Ed25519 using the private key.
   - Return base64-encoded signature.

Now integrate into the posting flow:

6. In src/engine/posting.ts:
   - If the incoming transaction includes a module_signature field:
     a. Look up the module's registered public key from the registered_modules table (by module_id).
     b. If the module has no public_key registered but provided a signature, reject with error code UNREGISTERED_MODULE_KEY.
     c. If the module has a public_key, verify the signature. If invalid, throw InvalidModuleSignatureError.
     d. If valid, include the signature on the chain entry.
   - If no signature is provided, set module_signature to null on the chain entry. This is valid — signatures are optional.

7. Create src/db/queries/modules.ts:
   - getModule(moduleId): returns the registered module record or null.
   - registerModule(moduleId, displayName, publicKey, allowedTypes): inserts a module.
   - updateModuleKey(moduleId, publicKey): updates the public key.

8. Create API endpoint:
   - POST /api/v1/gl/modules — register a module. Body: { module_id, display_name, public_key (PEM), allowed_transaction_types }.
   - GET /api/v1/gl/modules — list registered modules.

Write tests:

- Generate a test key pair. Register a module with the public key. Submit a signed transaction. Verify it is accepted and the signature is stored on the chain entry.
- Submit a transaction with an invalid signature (sign with a different key). Verify it is rejected with INVALID_MODULE_SIGNATURE.
- Submit an unsigned transaction from a registered module. Verify it is accepted (signatures are optional).
- Submit a transaction from an unregistered module with no signature. Verify it is accepted (module registration is not required for unsigned submissions).

Run all tests.
```

---

## Prompt 6 — Enhanced Approval Workflow

```
Read CLAUDE.md sections on approval enhancements. Implement delegation, escalation, multi-level approval, and segregation of duties.

Step 1 — Update the approval engine (src/engine/approval.ts):

Delegation:
- Create function getEffectiveApprovers(userId, now): returns the list of users whose authority this user currently holds (themselves + anyone who has delegated to them with an active, non-expired delegation).
- When checking if a user can approve a transaction, check both direct authority AND delegated authority.
- Create CRUD functions for delegations: createDelegation, revokeDelegation, getActiveDelegations.

Multi-level approval:
- Update the staging table to include an 'approvals' JSONB column (array of approval records).
- Each approval record: { approved_by: string, approved_at: string, notes: string | null }.
- When a user approves a staged transaction:
  a. Add their approval to the approvals array.
  b. Check the applicable approval rule's required_approvals count.
  c. If approvals.length >= required_approvals, the transaction is fully approved — commit it to the chain.
  d. If approvals.length < required_approvals, update staging status to 'PARTIALLY_APPROVED' and return a response indicating more approvals are needed.
- The same user cannot approve the same transaction twice.

Escalation:
- Create function checkAndEscalate():
  a. Query all staging entries with status 'PENDING' or 'PARTIALLY_APPROVED' where created_at < NOW() - escalation_threshold (configurable, default 48 hours).
  b. For each, check if the original required approver has a manager or escalation target defined (store this in the approval_rules or a separate config).
  c. Update the staging entry with escalation metadata: { escalated: true, escalated_at: timestamp, escalated_to: userId }.
  d. Trigger a webhook event APPROVAL_ESCALATED.
- This function should be called periodically. For V1, call it from a simple setInterval in the server startup (every 15 minutes).

Segregation of Duties:
- When a user attempts to approve a transaction:
  a. Look up the transaction's correlation_id.
  b. Query all committed transactions with the same correlation_id.
  c. Check if the approving user submitted any of those related transactions (check the source.module_id or the created_by field).
  d. If they did, reject the approval with SegregationOfDutiesError.

Step 2 — Update API endpoints:

- POST /api/v1/gl/approvals/:staging_id/approve — handle multi-level (may return 'PARTIALLY_APPROVED').
- POST /api/v1/gl/approvals/bulk-approve — body: { staging_ids: string[], notes?: string }. Process each approval independently. Return results array.
- POST /api/v1/gl/delegations — create delegation. Body: { delegate_id, valid_from, valid_until, scope? }.
- GET /api/v1/gl/delegations — list active delegations.
- DELETE /api/v1/gl/delegations/:id — revoke delegation.

Step 3 — Write tests:

- Delegation: User A delegates to User B. User B can approve transactions that require User A's authority.
- Delegation expiry: Create an expired delegation. Verify User B can no longer approve.
- Delegation scope: Create a delegation limited to MANUAL_JOURNAL type. Verify User B can approve a journal but not a supplier invoice.
- Multi-level: Create a rule requiring 2 approvals. First approval returns 'PARTIALLY_APPROVED'. Second approval commits the transaction.
- Multi-level same user: User A approves, then tries to approve again. Second attempt is rejected.
- Escalation: Create a staging entry with a created_at 3 days ago. Run checkAndEscalate. Verify it is marked as escalated.
- Segregation of duties: User A submits a SUPPLIER_INVOICE with correlation_id X. User A then tries to approve a SUPPLIER_PAYMENT with the same correlation_id. Verify it is rejected.
- Segregation of duties: User B (different user) can approve the related transaction.

Run all tests.
```

---

## Prompt 7 — Webhook Event Publishing

```
Read CLAUDE.md sections on webhooks. Implement the webhook system.

Step 1 — Webhook engine (src/engine/webhooks.ts):

Create the event publishing system:

1. publishEvent(eventType, payload): void (async, non-blocking)
   - Query webhook_subscriptions for active subscriptions matching event_type.
   - For each subscription:
     a. Insert a webhook_deliveries record with status 'PENDING'.
     b. Schedule delivery (use setImmediate or process.nextTick — do NOT await).

2. deliverWebhook(deliveryId): void (async)
   - Read the delivery record.
   - Read the subscription record.
   - Compute HMAC-SHA256 of the JSON payload using the subscription's secret.
   - Send HTTP POST to the callback_url with headers:
     - Content-Type: application/json
     - X-GL-Signature: sha256=<hmac_hex>
     - X-GL-Event: <event_type>
     - X-GL-Delivery: <delivery_id>
   - Set a 10-second timeout on the HTTP request.
   - If response status is 2xx: update delivery status to 'DELIVERED', set last_delivery_at on subscription, reset failure_count.
   - If response is non-2xx or timeout: update delivery to 'RETRYING', increment attempts. Schedule retry with exponential backoff (delays: 60s, 300s, 1800s, 7200s, 43200s). After 5 failed attempts, set status to 'FAILED' and increment subscription failure_count. If subscription failure_count > 10, set subscription is_active = false.

3. retryFailedDeliveries(): void (async)
   - Query webhook_deliveries with status 'RETRYING' and last_attempt_at < NOW() - backoff_interval.
   - For each, call deliverWebhook.
   - Call this from a setInterval in server startup (every 60 seconds).

Step 2 — Integrate events into existing flows:

In src/engine/posting.ts:
- After committing a transaction to the chain, call publishEvent('TRANSACTION_POSTED', { transaction_id, transaction_type, reference, period, total_amount, currency, chain_hash }).
- After approving a staged transaction, call publishEvent('TRANSACTION_APPROVED', { staging_id, transaction_id, approved_by }).
- After rejecting a staged transaction, call publishEvent('TRANSACTION_REJECTED', { staging_id, rejected_by, reason }).

In src/engine/periods.ts:
- After soft close, call publishEvent('PERIOD_SOFT_CLOSED', { period_id }).
- After hard close, call publishEvent('PERIOD_CLOSED', { period_id, closing_chain_hash, merkle_root }).

In src/engine/approval.ts:
- After escalation, call publishEvent('APPROVAL_ESCALATED', { staging_id, escalated_to }).

Step 3 — Webhook management API endpoints:

- POST /api/v1/gl/webhooks — register subscription. Body: { callback_url, event_types, secret }. Validate callback_url is a valid HTTPS URL (allow HTTP only in development). Validate event_types are valid event type codes.
- GET /api/v1/gl/webhooks — list subscriptions.
- DELETE /api/v1/gl/webhooks/:id — deactivate subscription.
- GET /api/v1/gl/webhooks/:id/deliveries — list deliveries for subscription. Query params: status, page, page_size.
- POST /api/v1/gl/webhooks/:id/test — send a test event to verify the endpoint is reachable.

Step 4 — Write tests:

- Create a mock HTTP server in the test that listens on localhost. Register a webhook pointing to it. Post a transaction. Verify the mock server receives the webhook with correct signature.
- Test HMAC signature verification: compute the expected HMAC and compare with the received X-GL-Signature header.
- Test retry logic: have the mock server return 500 on first attempt, 200 on second. Verify the delivery succeeds on retry.
- Test deactivation: have the mock server always return 500. Verify after many failures the subscription is deactivated.
- Test that webhook delivery does not block the transaction posting (the POST /transactions response should return before the webhook is delivered).

Run all tests.
```

---

## Prompt 8 — Advanced Reporting (P&L, Balance Sheet, Cash Flow)

```
Read CLAUDE.md sections on advanced reporting. Implement the three financial statements.

Step 1 — Report engine (src/engine/reports.ts):

Profit and Loss:
1. Create function generateProfitAndLoss(options: { period?, date_from?, date_to?, cost_centre?, department?, comparative_period? }):
   - Query transaction_lines joined with accounts where account category is REVENUE, DIRECT_COSTS, OVERHEADS, FINANCE_COSTS, or OTHER_INCOME.
   - Filter by date range (or period), and optional cost_centre/department.
   - Group by account_code and sum base_debit and base_credit for each account.
   - For REVENUE accounts: balance = sum(base_credit) - sum(base_debit). Positive = revenue.
   - For EXPENSE accounts: balance = sum(base_debit) - sum(base_credit). Positive = expense.
   - Organise into sections: Revenue, Cost of Sales (DIRECT_COSTS), Overheads, Finance Costs, Other Income.
   - Compute: gross_profit = revenue - cost_of_sales, net_profit = gross_profit - overheads - finance_costs + other_income.
   - Set data_flag based on period status.
   - If comparative_period is specified, run the same query for that period and include as a comparison.

Balance Sheet:
2. Create function generateBalanceSheet(options: { as_at_date?, period?, comparative_period? }):
   - For a specific date: sum all transaction_lines up to that date for ASSET, LIABILITY, and EQUITY accounts.
   - For a period: use the period's closing trial balance if closed, or running balances if open.
   - ASSET accounts: balance = sum(base_debit) - sum(base_credit). Positive = asset.
   - LIABILITY accounts: balance = sum(base_credit) - sum(base_debit). Positive = liability.
   - EQUITY accounts: balance = sum(base_credit) - sum(base_debit). Positive = equity.
   - Include retained earnings from P&L (current year's net profit added to retained earnings account).
   - Validate: total_assets = total_liabilities + total_equity. If not, flag an error.
   - Organise into sections: Current Assets, Fixed Assets, Current Liabilities, Long-term Liabilities, Equity.

Cash Flow (indirect method):
3. Create function generateCashFlow(options: { period, comparative_period? }):
   - Start with net profit from P&L.
   - Operating activities adjustments:
     a. Add back depreciation (sum of DEPRECIATION transaction types in the period).
     b. Add back stock write-offs.
     c. Working capital changes: change in debtors (1100), change in creditors (2000), change in stock (1300), change in prepayments (1400), change in accruals (2150). "Change" = closing balance - opening balance.
   - Investing activities: sum of transactions hitting fixed asset accounts (1500, 1510).
   - Financing activities: sum of transactions hitting equity accounts (3000) and loan accounts (if any).
   - Net change in cash = operating + investing + financing.
   - Opening cash = bank account (1000, 1050) balance at period start.
   - Closing cash = opening + net change. Verify this equals the actual bank balance at period end.

Step 2 — Report database queries (src/db/queries/reports.ts):

Add these query functions:
- getAccountBalancesByCategory(dateFrom, dateTo, categories): returns balances grouped by account and category.
- getAccountBalancesAsAt(asAtDate, categories): cumulative balances up to a date.
- getOpeningBalances(periodId): returns opening balances for a period.
- getTransactionTypeSum(periodId, transactionType): sum of amounts for a transaction type in a period.

Step 3 — API endpoints:

- GET /api/v1/gl/reports/profit-and-loss — Query params: period, date_from, date_to, comparative_period, cost_centre, department, format (summary/detailed).
- GET /api/v1/gl/reports/balance-sheet — Query params: as_at_date, period, comparative_period.
- GET /api/v1/gl/reports/cash-flow — Query params: period, method (indirect), comparative_period.

All report endpoints return:
```json
{
  "success": true,
  "data": {
    "report_type": "PROFIT_AND_LOSS",
    "period": "2026-03",
    "data_flag": "PROVISIONAL",
    "generated_at": "2026-03-15T10:00:00Z",
    "sections": [...],
    "totals": {...},
    "comparative": {...}
  }
}
```

Step 4 — Write tests:

- Post several transactions (customer invoices, supplier invoices, a manual journal for depreciation, a bank payment). Then:
  a. Generate P&L. Verify revenue = sum of customer invoices' revenue lines, COGS = sum of supplier invoices' expense lines, net profit is correct.
  b. Generate balance sheet. Verify assets = liabilities + equity.
  c. Generate cash flow. Verify closing cash matches the actual bank balance.
- Test comparative reports: close a period, post transactions in the next period, generate P&L with comparative. Verify both periods' figures are present.
- Test data_flag: open period shows PROVISIONAL, closed period shows AUTHORITATIVE.
- Test cost centre filtering on P&L.

Run all tests.
```

---

## Prompt 9 — Additional V1 API Endpoints

```
Read CLAUDE.md. Implement the remaining V1 API endpoints that haven't been built yet.

Step 1 — Chain verification endpoints (src/api/chain.ts):

- GET /api/v1/gl/chain/verify?period=2026-03
  Call chainReader.verifyChain(periodId). Return the verification result: { valid, entries, merkle_valid, error }.

- GET /api/v1/gl/chain/checkpoint/:period
  Look up the period. If it is HARD_CLOSE, return { period_id, closing_chain_hash, merkle_root, closed_at, closed_by }. If not closed, return 404 with message "Period is not yet closed".

- GET /api/v1/gl/chain/proof/:transaction_id
  Look up the transaction to get its period and merkle_index. Call chainReader.getMerkleProof(periodId, transactionSequence). Return the MerkleProof object. If the period is not closed (no Merkle root), return 400 with message "Merkle proofs are only available for closed periods".

Step 2 — Transaction type discovery (src/api/transaction-types.ts):

- GET /api/v1/gl/transaction-types
  Return the full catalogue of supported transaction types. For each type, include: code, description, category, required_fields, optional_fields, line_fields (required and optional), and default_postings (the default debit/credit account mappings).
  Load the default_postings from the transaction_type_mappings table.

Step 3 — Sub-ledger reconciliation endpoint (src/api/reconciliations.ts):

- POST /api/v1/gl/reconciliations
  Body: { period_id, module_id, control_account, module_balance, gl_balance, is_reconciled, notes }.
  Validate: the period exists and is SOFT_CLOSE or OPEN. The module_id is registered. The control_account exists.
  Insert into sub_ledger_reconciliations table.
  Return the reconciliation record.

- GET /api/v1/gl/reconciliations?period=2026-03
  Return all reconciliation records for the period.

Step 4 — Account ledger endpoint (update src/api/accounts.ts):

- GET /api/v1/gl/accounts/:code/ledger
  Query params: date_from, date_to, period, page (default 1), page_size (default 50).
  Return paginated list of transaction_lines for this account, joined with the transaction header for date, reference, type, and counterparty. Include a running balance column (cumulative debit - credit for assets, credit - debit for liabilities/equity/revenue).

Step 5 — Update the routes file (src/api/routes.ts) to register all new endpoints.

Step 6 — Write tests:

- Chain verification: post transactions, verify chain returns valid=true. Tamper with a chain file (modify a byte), verify chain returns valid=false.
- Chain checkpoint: close a period, verify checkpoint returns correct hash and Merkle root.
- Merkle proof: close a period with several transactions, request proofs for each, verify them client-side using the verifyProof function.
- Transaction type discovery: verify the endpoint returns all expected types with correct structures.
- Sub-ledger reconciliation: submit reconciliation, then attempt period close, verify it considers the reconciliation.
- Account ledger: post several transactions hitting the same account, request the ledger, verify entries are in date order with correct running balance.

Run all tests.
```

---

## Prompt 10 — MCP Server

```
Read CLAUDE.md and docs/MCP_SERVER_SPEC.md thoroughly. Implement the MCP server.

Step 1 — Install the MCP SDK:
npm install @modelcontextprotocol/sdk

Step 2 — Create the MCP server entry point (src/mcp/server.ts):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
```

Create a function createMcpServer(config) that:
1. Creates a new McpServer instance with name "gl-ledger" and version from package.json.
2. Registers all tools (from src/mcp/tools.ts).
3. Registers all resources (from src/mcp/resources.ts).
4. Returns the server.

Create the main entry point that:
1. Creates the server.
2. Connects it to StdioServerTransport.
3. Handles graceful shutdown on SIGINT/SIGTERM.

Step 3 — Create MCP tools (src/mcp/tools.ts):

Each tool is a thin wrapper around the engine layer functions. Define these tools:

gl_post_transaction:
- Description: "Submit a financial transaction to the General Ledger for posting. The transaction will be validated, expanded into double-entry postings, and either auto-approved or queued for manual review."
- Input schema: { transaction_type (string, required), reference (string, required), date (string, required, ISO date), currency (string, default "GBP"), exchange_rate (string, optional), counterparty (object, optional: { trading_account_id, contact_id }), description (string, required), lines (array of { description, net_amount, tax_code, tax_amount, account_override?, cost_centre?, department? }), source (object: { module_id, module_reference, correlation_id? }), idempotency_key (string, required) }
- Handler: call the posting engine's submitTransaction function. Return the result (POSTED with transaction_id and chain_hash, or AWAITING_APPROVAL with staging_id, or REJECTED with error details).

gl_query_journal:
- Description: "Search committed transactions in the General Ledger. Filter by date range, transaction type, account, counterparty, amount range, or free text."
- Input schema: { period (string, optional), date_from (string, optional), date_to (string, optional), transaction_type (string, optional), account_code (string, optional), counterparty (string, optional), amount_min (string, optional), amount_max (string, optional), page (number, default 1), page_size (number, default 20) }
- Handler: call the transaction query function. Return paginated results.

gl_get_trial_balance:
- Description: "Get the trial balance for a specific accounting period. Shows every account with a non-zero balance, with debit and credit columns."
- Input schema: { period (string, required), include_comparatives (boolean, default false) }
- Handler: call the trial balance report function. Return the full trial balance.

gl_get_account_balance:
- Description: "Get the current balance of a specific general ledger account."
- Input schema: { account_code (string, required), as_at_date (string, optional) }
- Handler: query the account balance.

gl_list_accounts:
- Description: "List or search the chart of accounts. Returns account codes, names, types, and current balances."
- Input schema: { category (string, optional, one of ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE), search (string, optional), active_only (boolean, default true) }
- Handler: query accounts.

gl_get_period_status:
- Description: "Check the current accounting period and its status (OPEN, SOFT_CLOSE, or HARD_CLOSE)."
- Input schema: { period (string, optional — if omitted, returns the current period) }
- Handler: query period status.

gl_approve_transaction:
- Description: "Approve a transaction that is pending in the approval queue."
- Input schema: { staging_id (string, required), notes (string, optional) }
- Handler: call the approval engine.

gl_reject_transaction:
- Description: "Reject a transaction that is pending in the approval queue."
- Input schema: { staging_id (string, required), reason (string, required) }
- Handler: call the rejection function.

gl_verify_chain:
- Description: "Verify the integrity of the hash chain for a specific accounting period. Returns whether the chain is valid and intact."
- Input schema: { period (string, required) }
- Handler: call chainReader.verifyChain.

Step 4 — Create MCP resources (src/mcp/resources.ts):

gl://accounts:
- Description: "The complete chart of accounts for this business, showing account codes, names, types (asset/liability/equity/revenue/expense), and current balances."
- Handler: query all active accounts with current-period balances.
- Return as formatted text (account list).

gl://periods:
- Description: "Current accounting period information including status and recent periods."
- Handler: query the last 6 periods.

gl://transaction-types:
- Description: "Catalogue of supported transaction types with their required fields and default account mappings."
- Handler: return the transaction type catalogue.

gl://approval-queue:
- Description: "Transactions currently pending approval, with summary counts and values."
- Handler: query the staging table for pending items.

Step 5 — MCP authentication bridge (src/mcp/auth.ts):

The MCP server needs to authenticate as a specific user. For V1:
- Read user_id from environment variable (MCP_USER_ID).
- Create a context object that is passed to all tool handlers.
- All tool handlers use this context for userId.

Step 6 — Add npm script to package.json:
"mcp": "tsx src/mcp/server.ts"

Step 7 — Write tests:

Test each MCP tool by:
1. Setting up test data (accounts, periods).
2. Calling the tool handler directly (not through stdio — import the handler function).
3. Verifying the result matches what the equivalent REST API would return.

Specific tests:
- gl_post_transaction: submit a MANUAL_JOURNAL, verify it is posted and returns transaction_id.
- gl_post_transaction: submit with missing required field, verify it returns an error.
- gl_query_journal: post several transactions, query by type, verify correct filtering.
- gl_get_trial_balance: post transactions, get trial balance, verify debits = credits.
- gl_list_accounts: verify all seeded accounts are returned.
- gl_approve_transaction: create a staged transaction, approve it via MCP, verify it is committed.
- gl_verify_chain: post transactions, verify chain, confirm valid=true.

Run all tests.
```

---

## Prompt 11 — Enhanced Web Frontend (V1 Pages)

```
Read CLAUDE.md sections on web frontend V1 enhancements. Build the new pages and enhance existing ones.

IMPORTANT: Use TanStack Query (@tanstack/react-query) for all API data fetching. Use Zustand for client-side state (user preferences, filter state). Install both:
npm install @tanstack/react-query zustand

Step 1 — Setup:
- Add TanStack Query provider to App.tsx.
- Create a Zustand store in src/web/src/store/appStore.ts for: selected period, currency display preference, sidebar collapsed state.
- Create shared API hooks in src/web/src/hooks/: useTransactions, useAccounts, usePeriods, useApprovals, useReports.

Step 2 — Profit and Loss page (src/web/src/pages/ProfitAndLoss.tsx):
- Period selector dropdown at top.
- Optional comparative period selector (prior period, same period last year).
- Report displayed as a formatted table:
  - Revenue section with account lines and subtotal.
  - Cost of Sales section with subtotal.
  - Gross Profit line (bold, highlighted).
  - Overheads section with subtotal.
  - Net Profit line (bold, highlighted, larger text).
- Each account line is clickable — links to account ledger.
- Data flag indicator: "PROVISIONAL" in amber, "AUTHORITATIVE" in green.
- Export buttons: PDF, XLSX (these can be placeholder buttons for V1 — the actual export is a future feature, but the buttons should be there).
- Use monospaced numbers aligned on decimal point. Debit amounts in left column, credit amounts in right column.

Step 3 — Balance Sheet page (src/web/src/pages/BalanceSheet.tsx):
- Date selector (as-at date) or period selector.
- Standard format: Assets, Liabilities, Equity sections.
- Each section: account lines with balances, section subtotal.
- Bottom: Total Assets line, Total Liabilities + Equity line. Both must match — highlight in red if they don't.
- Clickable account lines link to ledger.
- Data flag indicator.

Step 4 — Cash Flow page (src/web/src/pages/CashFlow.tsx):
- Period selector.
- Indirect method format:
  - Net Profit from operations.
  - Adjustments for non-cash items (itemised).
  - Working capital changes (itemised).
  - Net cash from operating activities.
  - Investing activities.
  - Financing activities.
  - Net change in cash.
  - Opening cash balance.
  - Closing cash balance.
- Closing cash should match the actual bank balance — indicate if it does.

Step 5 — Audit Trail page (src/web/src/pages/AuditTrail.tsx):
- Period selector.
- Two modes: Chain View and Verification.
- Chain View: scrollable list showing each chain entry with: sequence number, timestamp, type, transaction_id (if TRANSACTION), entry_hash (truncated with copy button), previous_hash (truncated), chain link indicator (green checkmark if hash links correctly).
- Verification mode: button to "Verify Chain Integrity". Shows progress (entry N of M). Final result: valid/invalid with details. If a Merkle root exists, show Merkle verification result.
- Individual transaction Merkle proof: click a transaction, see its Merkle proof path displayed as a tree diagram.

Step 6 — Enhanced Approval Queue:
- Add keyboard shortcuts: A = approve selected, R = reject selected (opens reason dialog), Up/Down arrows to navigate, Enter to expand detail, Escape to collapse.
- Add batch mode: checkbox on each item, "Approve Selected" and "Reject Selected" buttons.
- Show confidence score as a coloured badge (green > 0.9, amber 0.7-0.9, red < 0.7).
- Show escalation indicator (amber triangle) for escalated items.
- Show delegation indicator if the current user is acting as delegate.
- Add filter tabs: All, Pending, Partially Approved, Escalated.

Step 7 — Enhanced Dashboard:
- Add a card showing chain verification status (last verified, result).
- Add a card showing webhook delivery status (recent deliveries, any failures).
- Add multi-currency summary if transactions exist in non-base currencies.
- Add period closing readiness checklist when current period is in SOFT_CLOSE.

Step 8 — Enhanced Journal:
- Add currency filter.
- Add correlation ID grouping: transactions with the same correlation_id are visually grouped with a connecting line or shared background colour.
- Show module signature badge (shield icon) on signed transactions.

Step 9 — Enhanced Trial Balance:
- Add comparative period column (toggle on/off).
- Add variance column (current vs comparative, with percentage).
- Data flag shown prominently.

Step 10 — Enhanced Period Management:
- For SOFT_CLOSE periods: show sub-ledger reconciliation status checklist (which modules have confirmed, which haven't).
- For HARD_CLOSE periods: show Merkle root and closing chain hash.
- Closing action button shows the validation checklist running in real time (trial balance check, staging check, sequential check — each with a pass/fail indicator).

Step 11 — Webhook Management page (src/web/src/pages/WebhookManagement.tsx):
- List of subscriptions with: URL, event types, status, failure count.
- Add subscription form: URL input, event type checkboxes, secret input.
- For each subscription: expandable delivery history showing recent deliveries with status badges (green=delivered, amber=retrying, red=failed).
- "Test" button to send a test event.
- "Delete" button with confirmation.

Step 12 — Navigation:
- Update the sidebar navigation to include all new pages: Dashboard, Journal, Chart of Accounts, Approval Queue, Trial Balance, P&L, Balance Sheet, Cash Flow, Period Management, Audit Trail, Webhooks.
- Group them logically: Daily Work (Dashboard, Journal, Approvals), Reports (Trial Balance, P&L, Balance Sheet, Cash Flow), Settings (Chart of Accounts, Period Management, Webhooks, Audit Trail).

Build the frontend: cd src/web && npm run build
Verify it loads in the browser.
```

---

## Prompt 12 — Docker, Integration, and Final Verification

```
Update the Docker configuration and run final integration testing.

Step 1 — Update package.json:
Add these dependencies if not already present:
- @modelcontextprotocol/sdk
- @tanstack/react-query (in web/package.json)
- zustand (in web/package.json)

Add these scripts:
- "mcp": "tsx src/mcp/server.ts"
- "test:mcp": "jest --testPathPattern=tests/.*mcp"
- "webhooks:retry": "tsx src/scripts/retry-webhooks.ts"

Step 2 — Update Dockerfile:
- Multi-stage build: build stage compiles TypeScript and builds the React frontend, runtime stage copies the compiled output.
- Ensure the chain files directory (/data/chains) is created and writable.
- The CMD should run migrations, then start the server.

Step 3 — Update docker-compose.yml:
- Add MCP_USER_ID environment variable to the api service.
- Add a volume for chain files that persists across container restarts.
- Ensure the test database service is still present for integration tests.

Step 4 — Create a startup script that runs on container start:
1. Run database migrations (knex migrate:latest).
2. Run seed (knex seed:run — idempotent, should not fail if data exists).
3. Start the Express server.
4. Log: "GL V1 ready at http://localhost:3000"

Step 5 — Full integration test:

Run all tests: npm test

Then do a manual smoke test by running docker-compose up and verifying:
1. The frontend loads at http://localhost:3000.
2. The dashboard shows the current period and empty approval queue.
3. Create a manual journal entry through the web UI — verify it appears in the journal and the trial balance updates.
4. Post a multi-currency transaction via curl:
   curl -X POST http://localhost:3000/api/v1/gl/transactions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <dev-token>" \
     -d '{ "transaction_type": "MANUAL_JOURNAL", "reference": "TEST-MC-001", "date": "2026-03-05", "currency": "EUR", "exchange_rate": "0.86", "description": "Multi-currency test", "lines": [{"description": "Test debit", "net_amount": 1000, "tax_code": "ZERO", "tax_amount": 0, "account_override": "6200"}], "source": {"module_id": "general-ledger", "module_reference": "test"}, "idempotency_key": "test-mc-001" }'
5. Verify the chain integrity via the API: GET /api/v1/gl/chain/verify?period=2026-03
6. Verify the trial balance via the API: GET /api/v1/gl/reports/trial-balance?period=2026-03
7. Check the P&L and balance sheet endpoints return data.

Step 6 — Final test suite run:
npm test -- --verbose

Verify all tests pass. Fix any failures.

Commit everything.
```

---

## Summary of Build Order

| # | Prompt | What it builds | Dependencies |
|---|--------|---------------|--------------|
| 1 | Database Migrations | V1 schema additions | MVP database |
| 2 | Single-Tenant Architecture | (Removed — no multi-tenancy) | N/A |
| 3 | Multi-Currency | FX handling and dual amounts | Prompt 1 |
| 4 | Merkle Tree | Efficient single-tx verification | Prompt 1 |
| 5 | Digital Signatures | Module signing and verification | Prompt 1 |
| 6 | Enhanced Approvals | Delegation, escalation, multi-level, SoD | Prompts 1, 3 |
| 7 | Webhooks | Event publishing with retry | Prompts 1, 3 |
| 8 | Advanced Reporting | P&L, Balance Sheet, Cash Flow | Prompts 1, 3 |
| 9 | Additional API Endpoints | Chain verification, type discovery, reconciliation | Prompts 1-8 |
| 10 | MCP Server | AI agent integration | Prompts 1-9 |
| 11 | Enhanced Frontend | All V1 UI pages and features | Prompts 1-10 |
| 12 | Docker & Integration | Final packaging and testing | All above |

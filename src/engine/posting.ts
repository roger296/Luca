import { v4 as uuidv4 } from "uuid";
import Decimal from "decimal.js";
import * as accountsDb from "../db/queries/accounts";
import * as periodsDb from "../db/queries/periods";
import * as chainWriter from "../chain/writer";
import * as webhooks from "./webhooks";
import { expandLines } from "./mappings";
import { requireExchangeRate, validateExchangeRate, validateDualBalance, getBaseCurrencyForInstance } from "./currency";
import { evaluateApprovalRequirement, stageTransaction } from "./approval";
import { verifyModuleSignature } from "../chain/signatures";
import type { TransactionSubmission, PostingResult } from "./types";
import {
  ValidationError,
  DuplicateIdempotencyKeyError,
  PeriodNotFoundError,
  ModuleNotAuthorisedError,
  InvalidModuleSignatureError,
  UnregisteredModuleKeyError,
} from "./types";
import { knex } from "../db/connection";

// ─── Post a single transaction ────────────────────────────────────────────────

export async function postTransaction(
  submission: TransactionSubmission
): Promise<PostingResult> {
  // 1. Basic validation
  if (!submission.transaction_type) {
    throw new ValidationError("transaction_type is required");
  }
  if (!submission.date || !/^\d{4}-\d{2}-\d{2}$/.test(submission.date)) {
    throw new ValidationError("date must be in YYYY-MM-DD format");
  }
  if (!submission.lines || submission.lines.length === 0) {
    throw new ValidationError("At least one line is required");
  }
  if (!submission.source?.module_id) {
    throw new ValidationError("source.module_id is required");
  }

  // 2. Resolve period
  let periodId: string;
  if (submission.period_id) {
    const period = await periodsDb.getPeriod(submission.period_id);
    if (!period) throw new PeriodNotFoundError(submission.period_id);
    periodId = submission.period_id;
  } else {
    const current = await periodsDb.getCurrentPeriod();
    if (!current) throw new PeriodNotFoundError("(current)");
    periodId = current.period_id;
  }

  // 3. Check idempotency key
  if (submission.idempotency_key) {
    const existing = await knex("transactions")
      .where({ idempotency_key: submission.idempotency_key })
      .first();
    if (existing) throw new DuplicateIdempotencyKeyError(submission.idempotency_key);

    const existingStaging = await knex("staging")
      .where({ idempotency_key: submission.idempotency_key })
      .first();
    if (existingStaging) throw new DuplicateIdempotencyKeyError(submission.idempotency_key);
  }

  // 4. Validate module authorisation
  const module = await knex("registered_modules")
    .where({ module_id: submission.source.module_id, is_active: true })
    .first();

  if (module) {
    const allowedTypes = (module as Record<string, unknown>)["allowed_transaction_types"] as string[];
    if (Array.isArray(allowedTypes) && allowedTypes.length > 0 && !allowedTypes.includes(submission.transaction_type)) {
      throw new ModuleNotAuthorisedError(submission.source.module_id, submission.transaction_type);
    }
  }

  // 4b. Verify digital signature when present (optional but validated if provided)
  if (submission.module_signature) {
    const sigModuleId = submission.module_signature.module_id;
    const sigModule =
      sigModuleId === submission.source.module_id
        ? module
        : await knex("registered_modules")
            .where({ module_id: sigModuleId })
            .first();

    const publicKey = sigModule
      ? ((sigModule as Record<string, unknown>)["public_key"] as string | null)
      : null;

    if (!publicKey) {
      throw new UnregisteredModuleKeyError(sigModuleId);
    }

    const { module_signature: _sig, ...submissionToVerify } = submission;
    void _sig;
    verifyModuleSignature(submissionToVerify, submission.module_signature, publicKey);
  }

  // 5. Get base currency
  const baseCurrency = await getBaseCurrencyForInstance();
  const currency = submission.currency ?? baseCurrency;

  // 6. Validate and resolve exchange rate
  validateExchangeRate(currency, baseCurrency, submission.exchange_rate ?? null);
  const exchangeRate = requireExchangeRate(currency, baseCurrency, submission.exchange_rate);

  // 7. Expand lines via mappings
  const counterparty =
    submission.counterparty?.trading_account_id ??
    submission.counterparty?.contact_id;

  const expandedLines = await expandLines(
    submission.transaction_type,
    submission.lines,
    exchangeRate,
    baseCurrency,
    currency,
    counterparty
  );

  // 8. Validate dual balance
  const balanceResult = validateDualBalance(expandedLines);
  if (!balanceResult.transactionBalanced) {
    throw new ValidationError(
      "Transaction does not balance in " + currency + ": diff=" + balanceResult.transactionDiff
    );
  }
  if (!balanceResult.baseBalanced) {
    throw new ValidationError(
      "Transaction does not balance in base currency " + baseCurrency + ": diff=" + balanceResult.baseDiff
    );
  }

  // 9. Compute gross amount (sum of debit lines in transaction currency)
  const grossAmount = expandedLines
    .reduce((acc, l) => acc.plus(new Decimal(l.debit)), new Decimal(0))
    .toFixed(4);

  // 10. Evaluate approval requirement
  const approvalResult = await evaluateApprovalRequirement(
    submission.transaction_type,
    grossAmount
  );

  // 11. Auto-approve: commit immediately
  if (approvalResult.autoApprove) {
    return commitTransaction(submission, periodId, expandedLines, exchangeRate, currency, baseCurrency);
  }

  // 12. Needs approval: stage
  return stageTransaction(submission, grossAmount, periodId, approvalResult.rule);
}

// ─── Commit an approved transaction ──────────────────────────────────────────

export async function commitTransaction(
  submission: TransactionSubmission,
  periodId: string,
  preExpandedLines?: Array<{
    account_code: string;
    description: string;
    debit: string;
    credit: string;
    base_debit: string;
    base_credit: string;
    cost_centre: string | null;
    sequence: number;
  }>,
  resolvedExchangeRate?: string,
  resolvedCurrency?: string,
  resolvedBaseCurrency?: string
): Promise<PostingResult> {
  // Resolve base currency if not provided
  const baseCurrency = resolvedBaseCurrency ?? await getBaseCurrencyForInstance();
  const currency = resolvedCurrency ?? submission.currency ?? baseCurrency;
  const exchangeRate =
    resolvedExchangeRate ??
    requireExchangeRate(currency, baseCurrency, submission.exchange_rate);

  const counterparty =
    submission.counterparty?.trading_account_id ??
    submission.counterparty?.contact_id;

  const lines =
    preExpandedLines ??
    (await expandLines(
      submission.transaction_type,
      submission.lines,
      exchangeRate,
      baseCurrency,
      currency,
      counterparty
    ));

  // Generate transaction ID
  const seqRow = await knex("transactions")
    .where({ period_id: periodId })
    .count("* as count")
    .first();
  const existingCount = parseInt(
    String((seqRow as Record<string, unknown>)?.["count"] ?? "0"),
    10
  );
  const sequence = existingCount + 1;
  const transactionId = "TXN-" + periodId + "-" + String(sequence).padStart(5, "0");

  // Auto-create chain file for this period if it doesn't exist yet
  const periodChainExists = chainWriter.getLastEntry(periodId);
  if (!periodChainExists) {
    await chainWriter.createPeriodFile(periodId, null, {});
  }

  // Write chain entry
  const chainEntry = await chainWriter.appendEntry(
    periodId,
    "TRANSACTION",
    {
      transaction_id: transactionId,
      transaction_type: submission.transaction_type,
      reference: submission.reference ?? null,
      date: submission.date,
      currency,
      exchange_rate: exchangeRate,
      base_currency: baseCurrency,
      counterparty: submission.counterparty ?? null,
      description: submission.description ?? null,
      lines: lines.map((l) => ({
        account_code: l.account_code,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
        base_debit: l.base_debit,
        base_credit: l.base_credit,
        cost_centre: l.cost_centre,
      })),
      source: submission.source,
      idempotency_key: submission.idempotency_key ?? null,
    },
    submission.module_signature
  );

  // Compute gross amount
  const grossAmount = lines
    .reduce((acc, l) => acc.plus(new Decimal(l.debit)), new Decimal(0))
    .toFixed(4);

  // Insert transaction to DB
  await knex("transactions").insert({
    transaction_id: transactionId,
    transaction_type: submission.transaction_type,
    reference: submission.reference ?? null,
    date: submission.date,
    period_id: periodId,
    currency,
    exchange_rate: exchangeRate,
    base_currency: baseCurrency,
    counterparty_trading_account_id: submission.counterparty?.trading_account_id ?? null,
    counterparty_contact_id: submission.counterparty?.contact_id ?? null,
    description: submission.description ?? null,
    source_module: submission.source.module_id,
    source_reference: submission.source.module_reference ?? null,
    correlation_id: submission.source.correlation_id ?? null,
    idempotency_key: submission.idempotency_key ?? null,
    submitted_by: submission.approval_context?.submitted_by ?? null,
    chain_sequence: chainEntry.sequence,
    chain_hash: chainEntry.entry_hash,
    merkle_index: chainEntry.merkle_position?.index ?? null,
    module_signature: submission.module_signature
      ? JSON.stringify(submission.module_signature)
      : null,
    status: "POSTED",
  });

  // Insert transaction lines
  const lineInserts = lines.map((l) => ({
    id: uuidv4(),
    transaction_id: transactionId,
    account_code: l.account_code,
    description: l.description,
    debit: l.debit,
    credit: l.credit,
    base_debit: l.base_debit,
    base_credit: l.base_credit,
    cost_centre: l.cost_centre,
    line_number: l.sequence,
  }));

  await knex("transaction_lines").insert(lineInserts);

  // Best-effort account validation (non-blocking warning)
  for (const l of lines) {
    const acct = await accountsDb.getAccount(l.account_code);
    if (!acct) {
      console.warn("[posting] Warning: account " + l.account_code + " not found in DB after chain write");
    }
  }

  // Publish TRANSACTION_POSTED webhook (non-blocking)
  webhooks.publishEvent("TRANSACTION_POSTED", {
    transaction_id: transactionId,
    transaction_type: submission.transaction_type,
    reference: submission.reference ?? null,
    period: periodId,
    total_amount: grossAmount,
    currency,
    chain_hash: chainEntry.entry_hash,
  });

  return {
    status: "POSTED",
    transaction_id: transactionId,
    chain_hash: chainEntry.entry_hash,
    chain_sequence: chainEntry.sequence,
  };
}

// ─── Bulk posting ─────────────────────────────────────────────────────────────

export async function postBulk(
  submissions: TransactionSubmission[]
): Promise<PostingResult[]> {
  const results: PostingResult[] = [];

  for (const submission of submissions) {
    try {
      const result = await postTransaction(submission);
      results.push(result);
    } catch (err: unknown) {
      const errorCode = err instanceof Error ? err.constructor.name : "UNKNOWN_ERROR";
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      results.push({
        status: "REJECTED",
        error_code: errorCode,
        message,
      });
    }
  }

  return results;
}

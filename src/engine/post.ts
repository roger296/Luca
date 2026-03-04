import crypto from 'node:crypto';
import Decimal from 'decimal.js';
import type { Knex } from 'knex';
import { ChainWriter } from '../chain/writer';
import { db } from '../db/connection';
import { computeTotalAmount, evaluateApprovalRules } from './approve';
import { expandToPostingLines, fetchMappings } from './expand';
import type {
  CommittedResult,
  PostingLine,
  PostingResult,
  StagedResult,
  TransactionSubmission,
} from './types';
import { journalLinesToPostingLines, validateBalance, validateSubmission } from './validate';

// ---------------------------------------------------------------------------
// post.ts — core posting engine
// ---------------------------------------------------------------------------

const CHAIN_DIR = process.env['CHAIN_DIR'] ?? 'chains/default';

/** Generate a unique transaction ID: TXN-YYYY-MM-NNNNN */
async function generateTransactionId(trx: Knex.Transaction, periodId: string): Promise<string> {
  // Count existing transactions in this period and increment.
  const result = await trx('transactions')
    .where('period_id', periodId)
    .count<[{ count: string }]>('transaction_id as count')
    .first();
  const count = parseInt(result?.count ?? '0', 10) + 1;
  const seq = String(count).padStart(5, '0');
  return `TXN-${periodId}-${seq}`;
}

/** Generate a unique staging ID. */
function generateStagingId(): string {
  return `STG-${crypto.randomUUID()}`;
}

/**
 * The core posting engine.
 *
 * Steps:
 *   1. Structural validation (validateSubmission).
 *   2. Expand or validate lines.
 *   3. Double-entry balance check.
 *   4. Evaluate approval rules.
 *   5a. AUTO_APPROVED → write chain entry + DB mirror → return CommittedResult.
 *   5b. PENDING_REVIEW → write to staging table → return StagedResult.
 *
 * The chain write happens FIRST (step 5a), then the DB write.
 * If the DB write fails after the chain write, the chain entry stands —
 * the DB mirror can be rebuilt from the chain file.
 */
export async function postTransaction(
  submission: TransactionSubmission,
  chainWriterOverride?: ChainWriter,
): Promise<PostingResult> {
  // ── 1. Structural validation ─────────────────────────────────────────────
  validateSubmission(submission);

  // ── 2. Expand or convert lines ───────────────────────────────────────────
  // We need the DB for mappings and approval rules; wrap in a transaction.
  return db.transaction(async (trx) => {
    let lines: PostingLine[];

    if (submission.lines && submission.lines.length > 0) {
      // MANUAL_JOURNAL / PRIOR_PERIOD_ADJUSTMENT — caller supplies lines.
      lines = journalLinesToPostingLines(submission.lines);
    } else {
      // Amount-based types — expand from account mappings.
      const mappings = await fetchMappings(trx, submission.transaction_type);
      lines = expandToPostingLines(submission, mappings);
    }

    // ── 3. Balance check ─────────────────────────────────────────────────
    validateBalance(lines);

    // ── 4. Approval rule evaluation ──────────────────────────────────────
    const totalAmount = computeTotalAmount(
      submission.amount,
      lines.filter((l) => l.debit > 0),
    );
    const decision = await evaluateApprovalRules(trx, submission.transaction_type, totalAmount);

    const chainPayload = buildChainPayload(submission, lines);

    if (decision.outcome === 'PENDING_REVIEW') {
      // ── 5b. Stage for review ────────────────────────────────────────────
      const stagingId = generateStagingId();

      await trx('staging').insert({
        staging_id: stagingId,
        period_id: submission.period_id,
        transaction_type: submission.transaction_type,
        reference: submission.reference ?? null,
        date: submission.date,
        currency: submission.currency ?? 'GBP',
        description: submission.description ?? null,
        payload: JSON.stringify(chainPayload),
        status: 'PENDING',
        total_amount: totalAmount.toFixed(2),
        idempotency_key: submission.idempotency_key ?? null,
        submitted_by: submission.submitted_by ?? null,
        approval_rule_id: decision.rule_id,
      });

      const result: StagedResult = {
        status: 'STAGED',
        staging_id: stagingId,
        period_id: submission.period_id,
        rule_name: decision.rule_name,
      };
      return result;
    }

    // ── 5a. Auto-approved — commit ────────────────────────────────────────
    const writer =
      chainWriterOverride ??
      new ChainWriter({
        chainDir: CHAIN_DIR,
        getPeriodStatus: async (periodId: string) => {
          const row = await trx('periods')
            .where('period_id', periodId)
            .select('status')
            .first<{ status: string } | undefined>();
          return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
        },
      });

    // Chain write FIRST.
    const chainEntry = await writer.appendEntry(
      submission.period_id,
      'TRANSACTION',
      chainPayload,
      { softCloseOverride: submission.soft_close_override },
    );

    // Then DB write.
    const transactionId = await generateTransactionId(trx, submission.period_id);

    await trx('transactions').insert({
      transaction_id: transactionId,
      period_id: submission.period_id,
      transaction_type: submission.transaction_type,
      reference: submission.reference ?? null,
      date: submission.date,
      currency: submission.currency ?? 'GBP',
      description: submission.description ?? null,
      counterparty_trading_account_id: submission.counterparty?.trading_account_id ?? null,
      counterparty_contact_id: submission.counterparty?.contact_id ?? null,
      source_module_id: submission.source?.module_id ?? null,
      source_module_reference: submission.source?.module_reference ?? null,
      idempotency_key: submission.idempotency_key ?? null,
      status: 'COMMITTED',
      data_flag: 'PROVISIONAL',
      chain_sequence: chainEntry.sequence,
      chain_period_id: submission.period_id,
      chain_verified: false,
    });

    const lineInserts = lines.map((line) => ({
      transaction_id: transactionId,
      period_id: submission.period_id,
      account_code: line.account_code,
      description: line.description,
      debit: new Decimal(line.debit).toFixed(2),
      credit: new Decimal(line.credit).toFixed(2),
      cost_centre: line.cost_centre ?? null,
      data_flag: 'PROVISIONAL',
      chain_verified: false,
    }));

    await trx('transaction_lines').insert(lineInserts);

    const result: CommittedResult = {
      status: 'COMMITTED',
      transaction_id: transactionId,
      chain_sequence: chainEntry.sequence,
      period_id: submission.period_id,
    };
    return result;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds the payload object that is written to the chain file. */
function buildChainPayload(
  submission: TransactionSubmission,
  lines: PostingLine[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    transaction_type: submission.transaction_type,
    reference: submission.reference ?? null,
    date: submission.date,
    currency: submission.currency ?? 'GBP',
    description: submission.description ?? null,
    lines: lines.map((l) => ({
      account_code: l.account_code,
      description: l.description,
      debit: new Decimal(l.debit).toNumber(),
      credit: new Decimal(l.credit).toNumber(),
      ...(l.cost_centre ? { cost_centre: l.cost_centre } : {}),
    })),
  };

  if (submission.counterparty) {
    payload['counterparty'] = submission.counterparty;
  }
  if (submission.source) {
    payload['source'] = submission.source;
  }
  if (submission.idempotency_key) {
    payload['idempotency_key'] = submission.idempotency_key;
  }
  if (submission.adjustment_context) {
    payload['adjustment_context'] = submission.adjustment_context;
  }

  return payload;
}

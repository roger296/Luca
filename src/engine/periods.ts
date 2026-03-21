import Decimal from "decimal.js";
import { knex } from "../db/connection";
import * as periodsDb from "../db/queries/periods";
import * as chainWriter from "../chain/writer";
import * as webhooks from "./webhooks";
import type { Period } from "./types";
import {
  InvalidPeriodStateError,
  PeriodSequenceError,
  StagingNotClearError,
  TrialBalanceError,
  PeriodNotFoundError,
} from "./types";

// ─── Get current open period ──────────────────────────────────────────────────

export async function getCurrentPeriod(): Promise<Period> {
  const period = await periodsDb.getCurrentPeriod();
  if (!period) throw new PeriodNotFoundError("(current)");
  return period;
}

// ─── Soft close a period ──────────────────────────────────────────────────────

export async function softClosePeriod(periodId: string): Promise<Period> {
  const period = await periodsDb.getPeriod(periodId);
  if (!period) throw new PeriodNotFoundError(periodId);
  if (period.status !== "OPEN") {
    throw new InvalidPeriodStateError(
      "Period " + periodId + " must be OPEN to soft-close (current: " + period.status + ")"
    );
  }

  const pendingCount = await knex("staging")
    .where({ period_id: periodId, status: "PENDING" })
    .count("* as count")
    .first();
  const pending = parseInt(
    String((pendingCount as Record<string, unknown>)?.["count"] ?? "0"),
    10
  );
  if (pending > 0) throw new StagingNotClearError(pending);

  await periodsDb.updatePeriodStatus(periodId, "SOFT_CLOSE", "PROVISIONAL");

  webhooks.publishEvent("PERIOD_SOFT_CLOSED", {
    period_id: periodId,
    closed_at: new Date().toISOString(),
  });

  const updated = await periodsDb.getPeriod(periodId);
  return updated!;
}

// ─── Hard close a period ──────────────────────────────────────────────────────

export async function hardClosePeriod(periodId: string, closedBy: string): Promise<Period> {
  // 1. Validate state
  const period = await periodsDb.getPeriod(periodId);
  if (!period) throw new PeriodNotFoundError(periodId);
  if (period.status !== "SOFT_CLOSE") {
    throw new InvalidPeriodStateError(
      "Period " + periodId + " must be SOFT_CLOSE to hard-close (current: " + period.status + ")"
    );
  }

  // 2. Check previous period is HARD_CLOSE
  const previousPeriod = await periodsDb.getPreviousPeriod(periodId);
  if (previousPeriod && previousPeriod.status !== "HARD_CLOSE") {
    throw new PeriodSequenceError(
      "Previous period " + previousPeriod.period_id + " must be HARD_CLOSE before closing " + periodId
    );
  }

  // 3. Staging must be empty
  const stagingCount = await knex("staging")
    .where({ period_id: periodId })
    .whereIn("status", ["PENDING", "ESCALATED"])
    .count("* as count")
    .first();
  const stagingPending = parseInt(
    String((stagingCount as Record<string, unknown>)?.["count"] ?? "0"),
    10
  );
  if (stagingPending > 0) throw new StagingNotClearError(stagingPending);

  // 4. Trial balance check
  const tbRows = await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .where("t.period_id", periodId)
    .where("t.status", "POSTED")
    .select(
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    )
    .first();

  const totalDebit = new Decimal(
    String((tbRows as Record<string, unknown>)?.["total_debit"] ?? "0")
  );
  const totalCredit = new Decimal(
    String((tbRows as Record<string, unknown>)?.["total_credit"] ?? "0")
  );
  if (!totalDebit.equals(totalCredit)) {
    throw new TrialBalanceError(totalDebit.toFixed(4), totalCredit.toFixed(4));
  }

  // 5. Build closing trial balance
  const closingBalanceRows = await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.period_id", periodId)
    .where("t.status", "POSTED")
    .groupBy("tl.account_code", "a.category")
    .select(
      "tl.account_code",
      "a.category",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS credit")
    );

  const closingTrialBalance: Record<string, { debit: string; credit: string }> = {};
  for (const row of closingBalanceRows as Array<Record<string, string>>) {
    closingTrialBalance[row["account_code"]!] = {
      debit: row["debit"]!,
      credit: row["credit"]!,
    };
  }

  // 6. Get total transaction count
  const txCountRow = await knex("transactions")
    .where({ period_id: periodId, status: "POSTED" })
    .count("* as count")
    .first();
  const totalTransactions = parseInt(
    String((txCountRow as Record<string, unknown>)?.["count"] ?? "0"),
    10
  );

  // 7. Write PERIOD_CLOSE chain entry (sealPeriod computes Merkle root internally)
  const closingEntry = await chainWriter.sealPeriod(periodId, {
    period_id: periodId,
    closing_trial_balance: closingTrialBalance,
    total_transactions: totalTransactions,
    total_debits: totalDebit.toFixed(4),
    total_credits: totalCredit.toFixed(4),
    closed_by: closedBy,
    sub_ledger_reconciliations: {},
  });

  // 8. Update period in DB
  await periodsDb.updatePeriodStatus(periodId, "HARD_CLOSE", "AUTHORITATIVE");
  await periodsDb.updatePeriodClosingHash(
    periodId,
    closingEntry.entry_hash,
    String((closingEntry.payload as unknown as Record<string, unknown>)["merkle_root"] ?? "")
  );

  // 9. Open next period with balance sheet opening balances
  const bsOpeningBalances: Record<string, { debit: string; credit: string }> = {};
  for (const row of closingBalanceRows as Array<Record<string, string>>) {
    if (["ASSET", "LIABILITY", "EQUITY"].includes(row["category"]!)) {
      bsOpeningBalances[row["account_code"]!] = {
        debit: row["debit"]!,
        credit: row["credit"]!,
      };
    }
  }

  await openNextPeriod(periodId, bsOpeningBalances);

  // 10. Publish webhook
  webhooks.publishEvent("PERIOD_CLOSED", {
    period_id: periodId,
    closed_by: closedBy,
    closed_at: new Date().toISOString(),
    closing_hash: closingEntry.entry_hash,
    merkle_root: String((closingEntry.payload as unknown as Record<string, unknown>)["merkle_root"] ?? ""),
  });

  const updated = await periodsDb.getPeriod(periodId);
  return updated!;
}

// ─── Open next period ─────────────────────────────────────────────────────────

export async function openNextPeriod(
  currentPeriodId: string,
  closingBalances: Record<string, { debit: string; credit: string }>
): Promise<Period> {
  const [year, month] = currentPeriodId.split("-").map(Number);
  let nextYear = year;
  let nextMonth = (month ?? 1) + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const nextPeriodId =
    String(nextYear) + "-" + String(nextMonth).padStart(2, "0");

  await chainWriter.createPeriodFile(
    nextPeriodId,
    currentPeriodId,
    closingBalances
  );

  const newPeriod = await periodsDb.createPeriod({
    period_id: nextPeriodId,
    status: "OPEN",
    data_flag: "PROVISIONAL",
  });

  return newPeriod;
}

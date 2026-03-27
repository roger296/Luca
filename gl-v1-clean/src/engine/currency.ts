import Decimal from "decimal.js";
import { knex } from "../db/connection";
import { getBaseCurrency } from "../db/queries/company_settings";
import type { TransactionSubmission } from "./types";
import {
  ExchangeRateRequiredError,
  CurrencyMismatchError,
  ValidationError,
} from "./types";

export interface CurrencyAmount {
  amount: Decimal;
  currency: string;
}

export async function getBaseCurrencyForInstance(): Promise<string> {
  return getBaseCurrency();
}

export function convertToBaseCurrency(amount: Decimal, exchangeRate: Decimal): Decimal {
  return amount.mul(exchangeRate).toDecimalPlaces(4);
}

export async function getExchangeRate(
  fromCurrency: string, toCurrency: string, date: string
): Promise<string | null> {
  if (fromCurrency === toCurrency) return "1";
  const row = await knex("exchange_rates")
    .where("from_currency", fromCurrency)
    .where("to_currency", toCurrency)
    .where("effective_date", "<=", date)
    .orderBy("effective_date", "desc")
    .select("rate")
    .first();
  return row ? String((row as Record<string, unknown>)["rate"]) : null;
}

export function toBaseCurrency(amount: string, exchangeRate: string): string {
  return new Decimal(amount).mul(new Decimal(exchangeRate)).toFixed(4);
}

export function requireExchangeRate(currency: string, baseCurrency: string, exchangeRate?: string): string {
  if (currency === baseCurrency) return "1";
  if (!exchangeRate || exchangeRate.trim() === "") throw new ExchangeRateRequiredError(currency, baseCurrency);
  return exchangeRate;
}

export function validateExchangeRate(
  currency: string, baseCurrency: string, exchangeRate: string | null | undefined
): void {
  if (currency === baseCurrency) {
    if (exchangeRate !== null && exchangeRate !== undefined && exchangeRate !== "") {
      const r = new Decimal(exchangeRate);
      if (!r.eq(1)) throw new CurrencyMismatchError(currency, baseCurrency);
    }
    return;
  }
  if (!exchangeRate || exchangeRate.trim() === "") throw new ExchangeRateRequiredError(currency, baseCurrency);
  const r = new Decimal(exchangeRate);
  if (r.lte(0)) throw new ValidationError("Exchange rate must be a positive number, got: " + exchangeRate);
}

export function validateDualBalance(
  lines: Array<{ debit: string; credit: string; base_debit: string; base_credit: string; }>
): { transactionBalanced: boolean; baseBalanced: boolean; transactionDiff: string; baseDiff: string; } {
  let txDebit = new Decimal(0); let txCredit = new Decimal(0);
  let baseDebit = new Decimal(0); let baseCredit = new Decimal(0);
  for (const line of lines) {
    txDebit = txDebit.plus(new Decimal(line.debit));
    txCredit = txCredit.plus(new Decimal(line.credit));
    baseDebit = baseDebit.plus(new Decimal(line.base_debit));
    baseCredit = baseCredit.plus(new Decimal(line.base_credit));
  }
  const txDiff = txDebit.minus(txCredit).abs();
  const baseDiff = baseDebit.minus(baseCredit).abs();
  const tolerance = new Decimal("0.0001");
  return {
    transactionBalanced: txDiff.lte(tolerance), baseBalanced: baseDiff.lte(tolerance),
    transactionDiff: txDiff.toFixed(4), baseDiff: baseDiff.toFixed(4),
  };
}

// FX Revaluation
const FX_GAINS_LOSSES_ACCOUNT = "7200";

export interface FxRevaluationEntry {
  account_code: string;
  foreign_currency: string;
  foreign_net_balance: string;
  recorded_base_net_balance: string;
  new_rate: string;
  new_base_net_balance: string;
  adjustment: string;
}

export async function generateFxRevaluations(
  periodId: string,
  closingRates: Record<string, string>
): Promise<{ submissions: TransactionSubmission[]; entries: FxRevaluationEntry[] }> {
  const baseCurrency = await getBaseCurrencyForInstance();
  const submissions: TransactionSubmission[] = [];
  const entries: FxRevaluationEntry[] = [];

  for (const [foreignCurrency, newRateStr] of Object.entries(closingRates)) {
    if (foreignCurrency === baseCurrency) continue;
    const newRate = new Decimal(newRateStr);

    const rows = await knex("transaction_lines as tl")
      .join("transactions as t", "t.transaction_id", "tl.transaction_id")
      .join("accounts as a", "a.code", "tl.account_code")
      .where("t.period_id", periodId)
      .where("t.currency", foreignCurrency)
      .where("t.status", "POSTED")
      .whereIn("a.category", ["ASSET", "LIABILITY"])
      .groupBy("tl.account_code")
      .select(
        "tl.account_code",
        knex.raw("SUM(tl.debit::numeric)::text AS sum_debit"),
        knex.raw("SUM(tl.credit::numeric)::text AS sum_credit"),
        knex.raw("SUM(tl.base_debit::numeric)::text AS sum_base_debit"),
        knex.raw("SUM(tl.base_credit::numeric)::text AS sum_base_credit")
      );

    for (const row of rows) {
      const r = row as Record<string, string>;
      const accountCode = r["account_code"];
      const sumDebit = new Decimal(r["sum_debit"] ?? "0");
      const sumCredit = new Decimal(r["sum_credit"] ?? "0");
      const sumBaseDebit = new Decimal(r["sum_base_debit"] ?? "0");
      const sumBaseCredit = new Decimal(r["sum_base_credit"] ?? "0");
      const foreignNet = sumDebit.minus(sumCredit);
      const recordedBaseNet = sumBaseDebit.minus(sumBaseCredit);
      const newBaseNet = new Decimal(foreignNet.mul(newRate).toFixed(4));
      const adjustment = newBaseNet.minus(recordedBaseNet);
      if (adjustment.abs().lte(new Decimal("0.0001"))) continue;
      const adjustmentStr = adjustment.toFixed(4);
      const gainOrLoss = adjustment.gt(0) ? "gain" : "loss";
      const today = new Date().toISOString().slice(0, 10);

      entries.push({
        account_code: accountCode,
        foreign_currency: foreignCurrency,
        foreign_net_balance: foreignNet.toFixed(4),
        recorded_base_net_balance: recordedBaseNet.toFixed(4),
        new_rate: newRateStr,
        new_base_net_balance: newBaseNet.toFixed(4),
        adjustment: adjustmentStr,
      });

      submissions.push({
        transaction_type: "FX_REVALUATION",
        date: today,
        period_id: periodId,
        description: "FX revaluation: " + foreignCurrency + "/" + baseCurrency + " @ " + newRateStr + " (period " + periodId + ")",
        lines: [
          { account_code: accountCode, description: "FX revaluation - " + foreignCurrency + "/" + baseCurrency, net_amount: adjustmentStr },
          { account_code: FX_GAINS_LOSSES_ACCOUNT, description: "FX " + gainOrLoss + " - " + foreignCurrency + "/" + baseCurrency, net_amount: adjustment.negated().toFixed(4) },
        ],
        source: {
          module_id: "system",
          module_reference: "FX-REVAL-" + periodId + "-" + foreignCurrency,
          correlation_id: "fx-reval-" + periodId + "-" + foreignCurrency.toLowerCase(),
        },
        idempotency_key: "fx-reval-" + periodId + "-" + foreignCurrency + "-" + accountCode,
      });
    }
  }
  return { submissions, entries };
}

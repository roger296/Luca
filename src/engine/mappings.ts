import { knex } from "../db/connection";
import Decimal from "decimal.js";
import type { TransactionTypeMapping, MappingRule, TransactionLineInput } from "./types";
import { AccountNotFoundError } from "./types";
import * as accountsDb from "../db/queries/accounts";

// ─── Get mapping ──────────────────────────────────────────────────────────────

export async function getMapping(
  transactionType: string
): Promise<TransactionTypeMapping | null> {
  const row = await knex("transaction_type_mappings")
    .where({
      transaction_type: transactionType,
      is_active: true,
    })
    .first();
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    transaction_type: r["transaction_type"] as string,
    debit_rules:
      typeof r["debit_rules"] === "string"
        ? JSON.parse(r["debit_rules"] as string)
        : (r["debit_rules"] as MappingRule[]),
    credit_rules:
      typeof r["credit_rules"] === "string"
        ? JSON.parse(r["credit_rules"] as string)
        : (r["credit_rules"] as MappingRule[]),
    is_active: r["is_active"] as boolean,
  };
}

// ─── Expand lines ─────────────────────────────────────────────────────────────

interface ExpandedLine {
  account_code: string;
  description: string;
  debit: string;
  credit: string;
  base_debit: string;
  base_credit: string;
  cost_centre: string | null;
  sequence: number;
}

export async function expandLines(
  transactionType: string,
  inputLines: TransactionLineInput[],
  exchangeRate: string,
  _baseCurrency: string,
  _currency: string,
  counterparty?: string
): Promise<ExpandedLine[]> {
  const expanded: ExpandedLine[] = [];
  let seq = 1;

  // MANUAL_JOURNAL and PRIOR_PERIOD_ADJUSTMENT: use input lines directly.
  // net_amount: positive = debit, negative = credit.
  if (
    transactionType === "MANUAL_JOURNAL" ||
    transactionType === "PRIOR_PERIOD_ADJUSTMENT" ||
    transactionType === "FX_REVALUATION"
  ) {
    for (const line of inputLines) {
      const accountCode = line.account_code;
      if (!accountCode) {
        throw new AccountNotFoundError(
          "(missing account_code on manual journal line)"
        );
      }
      const netAmt = new Decimal(line.net_amount);
      const isDebit = netAmt.gte(0);
      const absAmt = netAmt.abs();
      const rate = new Decimal(exchangeRate);
      const baseAmt = absAmt.mul(rate);

      const account = await accountsDb.getAccount(accountCode);
      if (!account) throw new AccountNotFoundError(accountCode);

      expanded.push({
        account_code: accountCode,
        description: line.description,
        debit: isDebit ? absAmt.toFixed(4) : "0.0000",
        credit: isDebit ? "0.0000" : absAmt.toFixed(4),
        base_debit: isDebit ? baseAmt.toFixed(4) : "0.0000",
        base_credit: isDebit ? "0.0000" : baseAmt.toFixed(4),
        cost_centre: line.cost_centre ?? null,
        sequence: seq++,
      });
    }
    return expanded;
  }

  // All other types: use the mapping rules.
  const mapping = await getMapping(transactionType);
  if (!mapping) {
    throw new Error(
      `No active mapping found for transaction type ${transactionType}`
    );
  }

  const applyRules = async (
    rules: MappingRule[],
    isDebit: boolean
  ): Promise<void> => {
    for (const rule of rules) {
      for (const inputLine of inputLines) {
        const net = new Decimal(inputLine.net_amount ?? "0");
        const tax = new Decimal(inputLine.tax_amount ?? "0");

        let amount: Decimal;
        switch (rule.amount_source) {
          case "net":
            amount = net.abs();
            break;
          case "tax":
            amount = tax.abs();
            break;
          case "gross":
            amount = net.abs().plus(tax.abs());
            break;
          default:
            amount = net.abs();
        }

        if (amount.isZero()) continue;

        // Resolve account code — allow override if rule permits
        let accountCode = rule.account_code;
        if (rule.allow_override && inputLine.account_code) {
          accountCode = inputLine.account_code;
        }

        const account = await accountsDb.getAccount(accountCode);
        if (!account) throw new AccountNotFoundError(accountCode);

        // Substitute description template placeholders
        const description = rule.description_template
          .replace("{counterparty}", counterparty ?? "")
          .replace("{description}", inputLine.description ?? "");

        const rate = new Decimal(exchangeRate);
        const baseAmt = amount.mul(rate);

        expanded.push({
          account_code: accountCode,
          description,
          debit: isDebit ? amount.toFixed(4) : "0.0000",
          credit: isDebit ? "0.0000" : amount.toFixed(4),
          base_debit: isDebit ? baseAmt.toFixed(4) : "0.0000",
          base_credit: isDebit ? "0.0000" : baseAmt.toFixed(4),
          cost_centre: inputLine.cost_centre ?? null,
          sequence: seq++,
        });
      }
    }
  };

  await applyRules(mapping.debit_rules, true);
  await applyRules(mapping.credit_rules, false);

  return expanded;
}

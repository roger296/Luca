import type { Request, Response, NextFunction } from "express";
import { knex } from "../db/connection";

// GET /transaction-types

export async function listTransactionTypes(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rows = await knex("transaction_type_mappings")
      .where({ is_active: true })
      .select("transaction_type", "debit_rules", "credit_rules")
      .orderBy("transaction_type", "asc");

    type TxMeta = {
      description: string;
      category: string;
      required_fields: string[];
      optional_fields: string[];
    };

    const typeMetadata: Record<string, TxMeta> = {
      CUSTOMER_INVOICE: { description: "Record a sale to a customer", category: "SALES_AND_RECEIVABLES", required_fields: ["reference","date","counterparty","lines"], optional_fields: ["currency","exchange_rate","approval_context","description"] },
      CUSTOMER_CREDIT_NOTE: { description: "Reverse a customer invoice", category: "SALES_AND_RECEIVABLES", required_fields: ["reference","date","counterparty","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      CUSTOMER_PAYMENT: { description: "Record a payment received from a customer", category: "SALES_AND_RECEIVABLES", required_fields: ["reference","date","counterparty","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      BAD_DEBT_WRITE_OFF: { description: "Write off an irrecoverable customer balance", category: "SALES_AND_RECEIVABLES", required_fields: ["reference","date","counterparty","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      SUPPLIER_INVOICE: { description: "Record a purchase from a supplier", category: "PURCHASING_AND_PAYABLES", required_fields: ["reference","date","counterparty","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      SUPPLIER_CREDIT_NOTE: { description: "Reverse a supplier invoice", category: "PURCHASING_AND_PAYABLES", required_fields: ["reference","date","counterparty","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      SUPPLIER_PAYMENT: { description: "Record a payment made to a supplier", category: "PURCHASING_AND_PAYABLES", required_fields: ["reference","date","counterparty","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      STOCK_RECEIPT: { description: "Record receipt of stock into inventory", category: "STOCK_AND_INVENTORY", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      STOCK_DISPATCH: { description: "Record dispatch of stock from inventory", category: "STOCK_AND_INVENTORY", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      STOCK_WRITE_OFF: { description: "Write off damaged or lost stock", category: "STOCK_AND_INVENTORY", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      STOCK_TRANSFER: { description: "Transfer stock between locations", category: "STOCK_AND_INVENTORY", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      STOCK_REVALUATION: { description: "Revalue stock to a new carrying amount", category: "STOCK_AND_INVENTORY", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      BANK_RECEIPT: { description: "Record money received into a bank account", category: "BANKING_AND_CASH", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      BANK_PAYMENT: { description: "Record money paid out of a bank account", category: "BANKING_AND_CASH", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      BANK_TRANSFER: { description: "Transfer funds between bank accounts", category: "BANKING_AND_CASH", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      MANUAL_JOURNAL: { description: "Direct debit/credit journal entry posted by an accountant", category: "ADJUSTMENTS_AND_PERIOD_END", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context","description"] },
      PRIOR_PERIOD_ADJUSTMENT: { description: "Correction referencing a previously closed period", category: "ADJUSTMENTS_AND_PERIOD_END", required_fields: ["reference","date","lines","approval_context"], optional_fields: ["currency","exchange_rate"] },
      PERIOD_END_ACCRUAL: { description: "Record an accrual at period end", category: "ADJUSTMENTS_AND_PERIOD_END", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      PREPAYMENT_RECOGNITION: { description: "Recognise a previously deferred prepayment as an expense", category: "ADJUSTMENTS_AND_PERIOD_END", required_fields: ["reference","date","lines"], optional_fields: ["currency","exchange_rate","approval_context"] },
      DEPRECIATION: { description: "Record depreciation charge on fixed assets", category: "ADJUSTMENTS_AND_PERIOD_END", required_fields: ["reference","date","lines"], optional_fields: ["approval_context"] },
      FX_REVALUATION: { description: "Adjust foreign-currency balances for exchange rate movements", category: "ADJUSTMENTS_AND_PERIOD_END", required_fields: ["reference","date","lines"], optional_fields: ["approval_context"] },
      YEAR_END_CLOSE: { description: "Zero out P&L accounts to Retained Earnings at year end", category: "ADJUSTMENTS_AND_PERIOD_END", required_fields: ["reference","date","lines"], optional_fields: ["approval_context"] },
    };

    const lineFields = {
      required: ["description", "net_amount"],
      optional: ["account_override", "tax_code", "tax_amount", "cost_centre", "department", "dimensions"],
    };

    const parseRules = (rules: unknown): unknown[] => {
      if (Array.isArray(rules)) return rules as unknown[];
      if (typeof rules === "string") {
        try { return JSON.parse(rules) as unknown[]; } catch { return []; }
      }
      return [];
    };

    const transaction_types = rows.map((row) => {
      const r = row as { transaction_type: string; debit_rules: unknown; credit_rules: unknown };
      const meta: TxMeta = typeMetadata[r.transaction_type] ?? {
        description: r.transaction_type, category: "OTHER",
        required_fields: ["reference", "date", "lines"], optional_fields: [],
      };
      return {
        code: r.transaction_type,
        description: meta.description,
        category: meta.category,
        required_fields: meta.required_fields,
        optional_fields: meta.optional_fields,
        line_fields: lineFields,
        default_postings: { debit: parseRules(r.debit_rules), credit: parseRules(r.credit_rules) },
      };
    });

    res.json({ success: true, data: { transaction_types } });
  } catch (err) {
    next(err);
  }
}

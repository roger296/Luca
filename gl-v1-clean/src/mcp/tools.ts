// src/mcp/tools.ts
// MCP tool definitions and handlers.
// Each tool is a thin wrapper around engine layer functions.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { postTransaction, commitTransaction } from "../engine/posting";
import { processApproval } from "../engine/approval";
import * as txDb from "../db/queries/transactions";
import * as accountsDb from "../db/queries/accounts";
import * as periodsDb from "../db/queries/periods";
import * as reportsEngine from "../engine/reports";
import { verifyChain } from "../chain/reader";
import type { McpContext } from "./auth";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errResult(code: string, message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ status: "ERROR", error_code: code, message }, null, 2) }],
    isError: true,
  };
}

function wrapError(e: unknown): ToolResult {
  const error = e as Error & { code?: string };
  return errResult(error.code ?? error.constructor?.name ?? "INTERNAL_ERROR", error.message ?? "Unknown error");
}

// gl_post_transaction
export const postTransactionSchema = {
  transaction_type: z.enum([
    "CUSTOMER_INVOICE","CUSTOMER_CREDIT_NOTE","CUSTOMER_PAYMENT","BAD_DEBT_WRITE_OFF",
    "SUPPLIER_INVOICE","SUPPLIER_CREDIT_NOTE","SUPPLIER_PAYMENT",
    "STOCK_RECEIPT","STOCK_DISPATCH","STOCK_WRITE_OFF","STOCK_TRANSFER","STOCK_REVALUATION",
    "BANK_RECEIPT","BANK_PAYMENT","BANK_TRANSFER",
    "MANUAL_JOURNAL","PRIOR_PERIOD_ADJUSTMENT","PERIOD_END_ACCRUAL",
    "PREPAYMENT_RECOGNITION","DEPRECIATION","FX_REVALUATION",
  ]).describe("The type of transaction"),
  reference: z.string().describe("Your reference for this transaction"),
  date: z.string().describe("Accounting date (YYYY-MM-DD)"),
  currency: z.string().default("GBP").describe("Currency code (ISO 4217)"),
  exchange_rate: z.string().optional().describe("Exchange rate: 1 transaction currency = N base currency units"),
  counterparty: z.object({
    trading_account_id: z.string().optional(),
    contact_id: z.string().optional(),
  }).optional().describe("The other party in this transaction"),
  description: z.string().describe("Human-readable description"),
  lines: z.array(z.object({
    description: z.string(),
    net_amount: z.number().describe("Net amount before tax"),
    tax_code: z.string().optional().describe("Tax code e.g. STANDARD_VAT_20, ZERO_RATED"),
    tax_amount: z.number().optional().describe("Tax amount"),
    account_override: z.string().optional().describe("Override the default account code"),
    cost_centre: z.string().optional(),
    department: z.string().optional(),
  })).describe("The financial line items"),
  idempotency_key: z.string().describe("Unique key to prevent duplicate postings"),
  approval_context: z.object({
    submitted_by: z.string().optional(),
    confidence_score: z.number().optional(),
  }).optional(),
};

export async function handlePostTransaction(
  args: {
    transaction_type: string;
    reference: string;
    date: string;
    currency?: string;
    exchange_rate?: string;
    counterparty?: { trading_account_id?: string; contact_id?: string };
    description: string;
    lines: Array<{
      description: string;
      net_amount: number;
      tax_code?: string;
      tax_amount?: number;
      account_override?: string;
      cost_centre?: string;
      department?: string;
    }>;
    idempotency_key: string;
    approval_context?: { submitted_by?: string; confidence_score?: number };
  },
  context: McpContext
): Promise<ToolResult> {
  try {
    const lines = args.lines.map((l) => ({
      description: l.description,
      net_amount: String(l.net_amount),
      tax_code: l.tax_code,
      tax_amount: l.tax_amount !== undefined ? String(l.tax_amount) : undefined,
      account_code: l.account_override,
      cost_centre: l.cost_centre,
      department: l.department,
    }));
    const result = await postTransaction({
      transaction_type: args.transaction_type,
      reference: args.reference,
      date: args.date,
      currency: args.currency,
      exchange_rate: args.exchange_rate,
      counterparty: args.counterparty,
      description: args.description,
      lines,
      source: { module_id: context.sourceModule, module_reference: args.reference },
      idempotency_key: args.idempotency_key,
      approval_context: args.approval_context?.submitted_by ? { submitted_by: args.approval_context.submitted_by } : undefined,
    });
    return ok(result);
  } catch (e) { return wrapError(e); }
}

// gl_query_journal
export const queryJournalSchema = {
  period: z.string().optional().describe("Accounting period (e.g. 2026-03)"),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  transaction_type: z.string().optional(),
  account_code: z.string().optional().describe("Filter by account code"),
  counterparty: z.string().optional().describe("Trading account ID or contact ID"),
  reference: z.string().optional().describe("Search by reference"),
  amount_min: z.string().optional(),
  amount_max: z.string().optional(),
  page: z.number().default(1),
  page_size: z.number().default(20),
};

export async function handleQueryJournal(
  args: { period?: string; date_from?: string; date_to?: string; transaction_type?: string;
    account_code?: string; counterparty?: string; reference?: string;
    amount_min?: string; amount_max?: string; page?: number; page_size?: number; },
  context: McpContext
): Promise<ToolResult> {
  try {
    const result = await txDb.listTransactions({
      period_id: args.period,
      date_from: args.date_from,
      date_to: args.date_to,
      transaction_type: args.transaction_type,
      account_code: args.account_code,
      counterparty_trading_account_id: args.counterparty,
      reference: args.reference,
      page: args.page ?? 1,
      page_size: args.page_size ?? 20,
    });
    return ok(result);
  } catch (e) { return wrapError(e); }
}

// gl_get_trial_balance
export const getTrialBalanceSchema = {
  period: z.string().describe("Accounting period (e.g. 2026-03)"),
  include_comparatives: z.boolean().default(false).describe("Include prior period for comparison"),
};

export async function handleGetTrialBalance(
  args: { period: string; include_comparatives?: boolean },
  context: McpContext
): Promise<ToolResult> {
  try {
    const report = await reportsEngine.getTrialBalance({ period_id: args.period });
    return ok(report);
  } catch (e) { return wrapError(e); }
}

// gl_get_account_balance
export const getAccountBalanceSchema = {
  account_code: z.string().describe("Account code (e.g. 1100 for Trade Debtors)"),
  as_at_date: z.string().optional().describe("Balance as at this date (YYYY-MM-DD)"),
};

export async function handleGetAccountBalance(
  args: { account_code: string; as_at_date?: string },
  context: McpContext
): Promise<ToolResult> {
  try {
    const account = await accountsDb.getAccount(args.account_code);
    if (!account) return errResult("ACCOUNT_NOT_FOUND", `Account ${args.account_code} not found`);
    const balance = await accountsDb.getAccountBalance(args.account_code, {
      date_to: args.as_at_date,
    });
    return ok({ account_code: args.account_code, account_name: account.name,
      category: account.category, as_at_date: args.as_at_date ?? null,
      debit: balance.debit, credit: balance.credit, net: balance.net });
  } catch (e) { return wrapError(e); }
}

// gl_list_accounts
export const listAccountsSchema = {
  category: z.enum(["ASSET","LIABILITY","EQUITY","REVENUE","EXPENSE"]).optional()
    .describe("Filter by account category"),
  search: z.string().optional().describe("Search by name or code"),
  active_only: z.boolean().default(true),
};

export async function handleListAccounts(
  args: { category?: string; search?: string; active_only?: boolean },
  context: McpContext
): Promise<ToolResult> {
  try {
    const accounts = await accountsDb.listAccounts({
      category: args.category,
      active_only: args.active_only !== false,
      search: args.search,
    });
    return ok(accounts);
  } catch (e) { return wrapError(e); }
}

// gl_get_period_status
export const getPeriodStatusSchema = {
  period: z.string().optional().describe("Period to check (e.g. 2026-03). Omit for current period."),
};

export async function handleGetPeriodStatus(
  args: { period?: string },
  context: McpContext
): Promise<ToolResult> {
  try {
    let periodData;
    if (args.period) {
      periodData = await periodsDb.getPeriod(args.period);
      if (!periodData) return errResult("PERIOD_NOT_FOUND", `Period ${args.period} not found`);
    } else {
      periodData = await periodsDb.getCurrentPeriod();
      if (!periodData) return errResult("PERIOD_NOT_FOUND", "No open period found");
    }
    return ok(periodData);
  } catch (e) { return wrapError(e); }
}

// gl_approve_transaction
export const approveTransactionSchema = {
  staging_id: z.string().describe("The staging ID of the pending transaction"),
  notes: z.string().optional().describe("Optional notes to record with the approval"),
};

export async function handleApproveTransaction(
  args: { staging_id: string; notes?: string },
  context: McpContext
): Promise<ToolResult> {
  try {
    const { approved, fullyApproved, stagingEntry } = await processApproval(
      args.staging_id, "approve", context.userId, args.notes
    );
    if (!approved) return errResult("APPROVAL_FAILED", "Approval could not be processed");
    if (fullyApproved) {
      const postingResult = await commitTransaction(
        stagingEntry.payload, stagingEntry.period_id
      );
      return ok({ staging_id: args.staging_id, ...postingResult });
    }
    const approvals = stagingEntry.approvals ?? [];
    return ok({ status: "PARTIALLY_APPROVED", staging_id: args.staging_id,
      approvals_count: approvals.length });
  } catch (e) { return wrapError(e); }
}

// gl_reject_transaction
export const rejectTransactionSchema = {
  staging_id: z.string().describe("The staging ID of the pending transaction"),
  reason: z.string().describe("Reason for rejection"),
};

export async function handleRejectTransaction(
  args: { staging_id: string; reason: string },
  context: McpContext
): Promise<ToolResult> {
  try {
    const { stagingEntry } = await processApproval(
      args.staging_id, "reject", context.userId, undefined, args.reason
    );
    return ok({ status: "REJECTED", staging_id: args.staging_id,
      rejected_by: stagingEntry.rejected_by, rejected_at: stagingEntry.rejected_at,
      rejection_reason: stagingEntry.rejection_reason });
  } catch (e) { return wrapError(e); }
}

// gl_verify_chain
export const verifyChainSchema = {
  period: z.string().describe("Period to verify (e.g. 2026-03)"),
};

export async function handleVerifyChain(
  args: { period: string },
  context: McpContext
): Promise<ToolResult> {
  try {
    const result = verifyChain(args.period);
    return ok(result);
  } catch (e) { return wrapError(e); }
}

// registerTools
export function registerTools(server: McpServer, context: McpContext): void {
  server.tool(
    "gl_post_transaction",
    "Submit a financial transaction to the General Ledger for posting. The transaction will be validated, expanded into double-entry postings, and either auto-approved or queued for manual review.",
    postTransactionSchema,
    (args) => handlePostTransaction(args, context)
  );
  server.tool(
    "gl_query_journal",
    "Search committed transactions in the General Ledger. Filter by date range, transaction type, account, counterparty, or reference.",
    queryJournalSchema,
    (args) => handleQueryJournal(args, context)
  );
  server.tool(
    "gl_get_trial_balance",
    "Get the trial balance for a specific accounting period. Shows every account with a non-zero balance, with debit and credit columns.",
    getTrialBalanceSchema,
    (args) => handleGetTrialBalance(args, context)
  );
  server.tool(
    "gl_get_account_balance",
    "Get the current balance of a specific general ledger account.",
    getAccountBalanceSchema,
    (args) => handleGetAccountBalance(args, context)
  );
  server.tool(
    "gl_list_accounts",
    "List or search the chart of accounts. Returns account codes, names, types, and whether each account is active.",
    listAccountsSchema,
    (args) => handleListAccounts(args, context)
  );
  server.tool(
    "gl_get_period_status",
    "Check the status of an accounting period (OPEN, SOFT_CLOSE, or HARD_CLOSE). If no period is specified, returns the current open period.",
    getPeriodStatusSchema,
    (args) => handleGetPeriodStatus(args, context)
  );
  server.tool(
    "gl_approve_transaction",
    "Approve a transaction that is pending in the approval queue. The transaction will be committed to the immutable chain once all required approvals are received.",
    approveTransactionSchema,
    (args) => handleApproveTransaction(args, context)
  );
  server.tool(
    "gl_reject_transaction",
    "Reject a transaction that is pending in the approval queue. A reason must be provided.",
    rejectTransactionSchema,
    (args) => handleRejectTransaction(args, context)
  );
  server.tool(
    "gl_verify_chain",
    "Verify the integrity of the hash chain for a specific accounting period. Confirms the ledger has not been tampered with.",
    verifyChainSchema,
    (args) => handleVerifyChain(args, context)
  );
}

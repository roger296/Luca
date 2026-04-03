// src/mcp/tools.ts
// MCP tool definitions and handlers.
// Each tool is a thin wrapper around engine layer functions.
// The McpServer interface is a minimal stub — wire to the real SDK when deploying.

import { z } from 'zod';
import Decimal from 'decimal.js';
import { db } from '../db/connection';
import { postTransaction } from '../engine/post';

// ---------------------------------------------------------------------------
// Minimal McpServer interface (replace with @modelcontextprotocol/sdk when available)
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface McpServer {
  tool(
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
  ): void;
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errResult(code: string, message: string): ToolResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ status: 'ERROR', error_code: code, message }, null, 2) },
    ],
    isError: true,
  };
}

function wrapError(e: unknown): ToolResult {
  const err = e as Error & { code?: string };
  return errResult(
    err.code ?? err.constructor?.name ?? 'INTERNAL_ERROR',
    err.message ?? 'Unknown error',
  );
}

// ---------------------------------------------------------------------------
// gl_post_transaction
// ---------------------------------------------------------------------------

export const postTransactionSchema = {
  transaction_type: z
    .enum([
      'MANUAL_JOURNAL',
      'CUSTOMER_INVOICE',
      'CUSTOMER_CREDIT_NOTE',
      'SUPPLIER_INVOICE',
      'SUPPLIER_CREDIT_NOTE',
      'CUSTOMER_PAYMENT',
      'SUPPLIER_PAYMENT',
      'BAD_DEBT_WRITE_OFF',
      'BANK_RECEIPT',
      'BANK_PAYMENT',
      'BANK_TRANSFER',
      'PERIOD_END_ACCRUAL',
      'DEPRECIATION',
      'YEAR_END_CLOSE',
      'PRIOR_PERIOD_ADJUSTMENT',
    ])
    .describe('The type of transaction'),
  date: z.string().describe('Accounting date (YYYY-MM-DD)'),
  period_id: z.string().describe('Accounting period (YYYY-MM)'),
  reference: z.string().optional().describe('Reference for this transaction'),
  description: z.string().optional().describe('Human-readable description'),
  amount: z.number().optional().describe('Gross amount for amount-based transaction types'),
  lines: z
    .array(
      z.object({
        account_code: z.string(),
        description: z.string().optional(),
        debit: z.number(),
        credit: z.number(),
        cost_centre: z.string().optional(),
      }),
    )
    .optional()
    .describe('Explicit lines for MANUAL_JOURNAL / PRIOR_PERIOD_ADJUSTMENT'),
  counterparty: z
    .object({
      trading_account_id: z.string().optional(),
      contact_id: z.string().optional(),
    })
    .optional(),
  idempotency_key: z.string().optional(),
  submitted_by: z.string().optional(),
  soft_close_override: z.boolean().optional(),
};

export async function handlePostTransaction(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const result = await postTransaction({
      transaction_type: args['transaction_type'] as string as import('../engine/types').TransactionType,
      date: args['date'] as string,
      period_id: args['period_id'] as string,
      reference: args['reference'] as string | undefined,
      description: args['description'] as string | undefined,
      amount: args['amount'] as number | undefined,
      lines: args['lines'] as import('../engine/types').JournalLine[] | undefined,
      counterparty: args['counterparty'] as import('../engine/types').Counterparty | undefined,
      idempotency_key: args['idempotency_key'] as string | undefined,
      submitted_by: args['submitted_by'] as string | undefined,
      soft_close_override: args['soft_close_override'] as boolean | undefined,
    });
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_query_journal
// ---------------------------------------------------------------------------

export const queryJournalSchema = {
  period_id: z.string().optional().describe('Accounting period (e.g. 2026-03)'),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  transaction_type: z.string().optional(),
  account_code: z.string().optional(),
  limit: z.number().default(50),
};

export async function handleQueryJournal(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    let q = db('transactions').orderBy('date', 'desc').orderBy('transaction_id', 'desc');
    if (args['period_id']) q = q.where('period_id', args['period_id']);
    if (args['date_from']) q = q.where('date', '>=', args['date_from']);
    if (args['date_to']) q = q.where('date', '<=', args['date_to']);
    if (args['transaction_type']) q = q.where('transaction_type', args['transaction_type']);
    q = q.limit((args['limit'] as number) ?? 50);
    const rows = await q;
    return ok(rows);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_trial_balance
// ---------------------------------------------------------------------------

export const getTrialBalanceSchema = {
  period_id: z.string().describe('Accounting period (e.g. 2026-03)'),
};

export async function handleGetTrialBalance(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const periodId = args['period_id'] as string;
    const rows = await db('transaction_lines')
      .join('accounts', 'transaction_lines.account_code', 'accounts.code')
      .where('transaction_lines.period_id', periodId)
      .select(
        'accounts.code',
        'accounts.name',
        'accounts.type',
        'accounts.category',
        db.raw('COALESCE(SUM(transaction_lines.debit), 0) as total_debits'),
        db.raw('COALESCE(SUM(transaction_lines.credit), 0) as total_credits'),
      )
      .groupBy('accounts.code', 'accounts.name', 'accounts.type', 'accounts.category')
      .orderBy('accounts.code');
    const totalDebits = rows.reduce((s: Decimal, r: { total_debits: string }) => s.plus(r.total_debits), new Decimal(0));
    const totalCredits = rows.reduce((s: Decimal, r: { total_credits: string }) => s.plus(r.total_credits), new Decimal(0));
    return ok({ period_id: periodId, lines: rows, total_debits: totalDebits.toFixed(2), total_credits: totalCredits.toFixed(2), balanced: totalDebits.equals(totalCredits) });
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_account_balance
// ---------------------------------------------------------------------------

export const getAccountBalanceSchema = {
  account_code: z.string().describe('Account code (e.g. 1100)'),
  as_at_date: z.string().optional().describe('Balance as at this date (YYYY-MM-DD)'),
};

export async function handleGetAccountBalance(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const accountCode = args['account_code'] as string;
    const account = await db('accounts').where('code', accountCode).first<{ code: string; name: string; type: string; category: string | null } | undefined>();
    if (!account) return errResult('ACCOUNT_NOT_FOUND', `Account ${accountCode} not found`);
    let q = db('transaction_lines').where('account_code', accountCode);
    if (args['as_at_date']) {
      q = q.join('transactions', 'transaction_lines.transaction_id', 'transactions.transaction_id').where('transactions.date', '<=', args['as_at_date'] as string);
    }
    const bal = await q.select(db.raw('COALESCE(SUM(debit), 0) as total_debits'), db.raw('COALESCE(SUM(credit), 0) as total_credits')).first<{ total_debits: string; total_credits: string }>();
    const d = new Decimal(bal?.total_debits ?? 0);
    const c = new Decimal(bal?.total_credits ?? 0);
    return ok({ account_code: accountCode, account_name: account.name, type: account.type, debit: d.toFixed(2), credit: c.toFixed(2), net: d.minus(c).toFixed(2) });
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_list_accounts
// ---------------------------------------------------------------------------

export const listAccountsSchema = {
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']).optional(),
  active_only: z.boolean().default(true),
};

export async function handleListAccounts(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    let q = db('accounts').orderBy('code');
    if (args['type']) q = q.where('type', args['type']);
    if (args['active_only'] !== false) q = q.where('active', true);
    return ok(await q);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_period_status
// ---------------------------------------------------------------------------

export const getPeriodStatusSchema = {
  period_id: z.string().optional().describe('Period to check (e.g. 2026-03). Omit for current.'),
};

export async function handleGetPeriodStatus(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    let row;
    if (args['period_id']) {
      row = await db('periods').where('period_id', args['period_id']).first();
      if (!row) return errResult('PERIOD_NOT_FOUND', `Period ${args['period_id']} not found`);
    } else {
      row = await db('periods').where('status', 'OPEN').orderBy('period_id', 'desc').first();
      if (!row) return errResult('PERIOD_NOT_FOUND', 'No open period found');
    }
    return ok(row);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_approve_transaction
// ---------------------------------------------------------------------------

export const approveTransactionSchema = {
  staging_id: z.string().describe('The staging ID of the pending transaction'),
};

export async function handleApproveTransaction(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const stagingId = args['staging_id'] as string;
    const row = await db('staging').where('staging_id', stagingId).first<{ status: string } | undefined>();
    if (!row) return errResult('NOT_FOUND', `Staging entry ${stagingId} not found`);
    if (row.status !== 'PENDING') return errResult('INVALID_STATE', `Entry is ${row.status}, not PENDING`);
    await db('staging').where('staging_id', stagingId).update({ status: 'APPROVED', reviewed_at: new Date().toISOString() });
    return ok({ staging_id: stagingId, status: 'APPROVED' });
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_reject_transaction
// ---------------------------------------------------------------------------

export const rejectTransactionSchema = {
  staging_id: z.string().describe('The staging ID of the pending transaction'),
  reason: z.string().describe('Reason for rejection'),
};

export async function handleRejectTransaction(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const stagingId = args['staging_id'] as string;
    const row = await db('staging').where('staging_id', stagingId).first<{ status: string } | undefined>();
    if (!row) return errResult('NOT_FOUND', `Staging entry ${stagingId} not found`);
    if (row.status !== 'PENDING') return errResult('INVALID_STATE', `Entry is ${row.status}, not PENDING`);
    await db('staging').where('staging_id', stagingId).update({ status: 'REJECTED', reviewed_at: new Date().toISOString(), rejection_reason: args['reason'] });
    return ok({ staging_id: stagingId, status: 'REJECTED', rejection_reason: args['reason'] });
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_verify_chain
// ---------------------------------------------------------------------------

export const verifyChainSchema = {
  period_id: z.string().describe('Period to verify (e.g. 2026-03)'),
};

export async function handleVerifyChain(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { ChainReader } = await import('../chain/reader');
    const { config } = await import('../config');
    const reader = new ChainReader(config.chainDir);
    const result = await reader.verifyChain(args['period_id'] as string);
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_profit_and_loss
// ---------------------------------------------------------------------------

export const getProfitAndLossSchema = {
  period_id: z.string().describe('Accounting period (YYYY-MM)'),
  from_date: z.string().optional().describe('Optional start date (YYYY-MM-DD)'),
  to_date: z.string().optional().describe('Optional end date (YYYY-MM-DD)'),
};

export async function handleGetProfitAndLoss(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { getProfitAndLoss } = await import('../engine/reports');
    const result = await getProfitAndLoss({
      period_id: args['period_id'] as string,
      from_date: args['from_date'] as string | undefined,
      to_date: args['to_date'] as string | undefined,
    });
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_balance_sheet
// ---------------------------------------------------------------------------

export const getBalanceSheetSchema = {
  period_id: z.string().optional().describe('Accounting period (YYYY-MM)'),
  as_at_date: z.string().optional().describe('Balance as at date (YYYY-MM-DD)'),
};

export async function handleGetBalanceSheet(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { getBalanceSheet } = await import('../engine/reports');
    const result = await getBalanceSheet({
      period_id: args['period_id'] as string | undefined,
      as_at_date: args['as_at_date'] as string | undefined,
    });
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_aged_debtors
// ---------------------------------------------------------------------------

export const getAgedDebtorsSchema = {
  as_at_date: z.string().optional().describe('Report date (YYYY-MM-DD), defaults to today'),
};

export async function handleGetAgedDebtors(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { getAgedDebtors } = await import('../engine/reports');
    const result = await getAgedDebtors({ as_at_date: args['as_at_date'] as string | undefined });
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_aged_creditors
// ---------------------------------------------------------------------------

export const getAgedCreditorsSchema = {
  as_at_date: z.string().optional().describe('Report date (YYYY-MM-DD), defaults to today'),
};

export async function handleGetAgedCreditors(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { getAgedCreditors } = await import('../engine/reports');
    const result = await getAgedCreditors({ as_at_date: args['as_at_date'] as string | undefined });
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_get_vat_return
// ---------------------------------------------------------------------------

export const getVatReturnSchema = {
  quarter_end: z.string().describe('Quarter end period (YYYY-MM), e.g. 2026-03 for Jan-Mar 2026'),
};

export async function handleGetVatReturn(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { getVatReturn } = await import('../engine/reports');
    const result = await getVatReturn({ quarter_end: args['quarter_end'] as string });
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// gl_year_end_close
// ---------------------------------------------------------------------------

export const yearEndCloseSchema = {
  financial_year_end: z.string().describe('Last period of the financial year (YYYY-MM)'),
  new_year_first_period: z.string().describe('First period of the new financial year (YYYY-MM)'),
};

export async function handleYearEndClose(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { executeYearEndClose } = await import('../engine/year-end');
    const result = await executeYearEndClose(
      args['financial_year_end'] as string,
      args['new_year_first_period'] as string,
    );
    return ok(result);
  } catch (e) {
    return wrapError(e);
  }
}

// ---------------------------------------------------------------------------
// registerTools — wire all tools into the MCP server
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  server.tool(
    'gl_post_transaction',
    'Submit a financial transaction to the General Ledger for posting.',
    postTransactionSchema,
    handlePostTransaction,
  );
  server.tool(
    'gl_query_journal',
    'Search committed transactions in the General Ledger.',
    queryJournalSchema,
    handleQueryJournal,
  );
  server.tool(
    'gl_get_trial_balance',
    'Get the trial balance for a specific accounting period.',
    getTrialBalanceSchema,
    handleGetTrialBalance,
  );
  server.tool(
    'gl_get_account_balance',
    'Get the current balance of a specific general ledger account.',
    getAccountBalanceSchema,
    handleGetAccountBalance,
  );
  server.tool(
    'gl_list_accounts',
    'List or search the chart of accounts.',
    listAccountsSchema,
    handleListAccounts,
  );
  server.tool(
    'gl_get_period_status',
    'Check the status of an accounting period.',
    getPeriodStatusSchema,
    handleGetPeriodStatus,
  );
  server.tool(
    'gl_approve_transaction',
    'Approve a transaction pending in the approval queue.',
    approveTransactionSchema,
    handleApproveTransaction,
  );
  server.tool(
    'gl_reject_transaction',
    'Reject a transaction pending in the approval queue.',
    rejectTransactionSchema,
    handleRejectTransaction,
  );
  server.tool(
    'gl_verify_chain',
    'Verify the integrity of the hash chain for a specific accounting period.',
    verifyChainSchema,
    handleVerifyChain,
  );
  server.tool(
    'gl_get_profit_and_loss',
    'Get the Profit and Loss report for an accounting period.',
    getProfitAndLossSchema,
    handleGetProfitAndLoss,
  );
  server.tool(
    'gl_get_balance_sheet',
    'Get the Balance Sheet as at a specific period or date.',
    getBalanceSheetSchema,
    handleGetBalanceSheet,
  );
  server.tool(
    'gl_get_aged_debtors',
    'Get the aged debtors report showing outstanding customer balances by age.',
    getAgedDebtorsSchema,
    handleGetAgedDebtors,
  );
  server.tool(
    'gl_get_aged_creditors',
    'Get the aged creditors report showing outstanding supplier balances by age.',
    getAgedCreditorsSchema,
    handleGetAgedCreditors,
  );
  server.tool(
    'gl_get_vat_return',
    'Get the VAT return figures for a quarterly period.',
    getVatReturnSchema,
    handleGetVatReturn,
  );
  server.tool(
    'gl_year_end_close',
    'Execute year-end closing entries to transfer P&L balances to Retained Earnings.',
    yearEndCloseSchema,
    handleYearEndClose,
  );
}

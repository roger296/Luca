import { knex } from "../connection";
import type { Transaction, TransactionLine } from "../../engine/types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

async function attachLines(
  transactions: Transaction[]
): Promise<Transaction[]> {
  if (transactions.length === 0) return transactions;

  const ids = transactions.map((t) => t.transaction_id);
  const lines = await knex("transaction_lines")
    .whereIn("transaction_id", ids)
    .orderBy(["transaction_id", "line_number"]);

  const linesByTxn: Record<string, TransactionLine[]> = {};
  for (const line of lines) {
    const l = line as TransactionLine;
    if (!linesByTxn[l.transaction_id]) {
      linesByTxn[l.transaction_id] = [];
    }
    linesByTxn[l.transaction_id].push(l);
  }

  return transactions.map((t) => ({
    ...t,
    lines: linesByTxn[t.transaction_id] ?? [],
  }));
}

export async function getTransaction(
  transactionId: string
): Promise<Transaction | null> {
  const row = await knex("transactions")
    .where({ transaction_id: transactionId })
    .first();

  if (!row) return null;

  const txn = row as Transaction;
  const [withLines] = await attachLines([txn]);
  return withLines;
}

export async function listTransactions(
  filters?: {
    period_id?: string;
    date_from?: string;
    date_to?: string;
    transaction_type?: string;
    account_code?: string;
    counterparty_trading_account_id?: string;
    correlation_id?: string;
    reference?: string;
    source_module?: string;
    currency?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }
): Promise<{ data: Transaction[]; total: number }> {
  const pageSize = Math.min(filters?.page_size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(filters?.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const allowedSortColumns: Record<string, string> = {
    date: "t.date",
    transaction_id: "t.transaction_id",
    transaction_type: "t.transaction_type",
    reference: "t.reference",
    created_at: "t.created_at",
  };
  const sortBy = allowedSortColumns[filters?.sort_by ?? ""] ?? "t.date";
  const sortOrder =
    filters?.sort_order?.toLowerCase() === "asc" ? "asc" : "desc";

  function buildBase() {
    const q = knex("transactions as t");

    if (filters?.period_id) q.where("t.period_id", filters.period_id);
    if (filters?.date_from) q.where("t.date", ">=", filters.date_from);
    if (filters?.date_to) q.where("t.date", "<=", filters.date_to);
    if (filters?.transaction_type) q.where("t.transaction_type", filters.transaction_type);
    if (filters?.counterparty_trading_account_id)
      q.where("t.counterparty_trading_account_id", filters.counterparty_trading_account_id);
    if (filters?.correlation_id) q.where("t.correlation_id", filters.correlation_id);
    if (filters?.reference) q.where("t.reference", filters.reference);
    if (filters?.source_module) q.where("t.source_module", filters.source_module);
    if (filters?.currency) q.where("t.currency", filters.currency);

    if (filters?.account_code) {
      q.join("transaction_lines as tl", "tl.transaction_id", "t.transaction_id")
        .where("tl.account_code", filters.account_code).distinct("t.*");
    }

    return q;
  }

  const countQuery = buildBase().count<{ count: string }[]>("t.id as count").first();
  const dataQuery = buildBase()
    .select("t.*")
    .orderBy(sortBy, sortOrder)
    .limit(pageSize)
    .offset(offset);

  const [countResult, rows] = await Promise.all([countQuery, dataQuery]);
  const total = parseInt((countResult as { count: string } | undefined)?.count ?? "0", 10);

  return { data: rows as Transaction[], total };
}

export async function insertTransaction(
  data: {
    transaction_id: string;
    transaction_type: string;
    reference?: string;
    date: string;
    period_id: string;
    currency: string;
    exchange_rate: string;
    base_currency: string;
    counterparty_trading_account_id?: string;
    counterparty_contact_id?: string;
    description?: string;
    source_module?: string;
    source_reference?: string;
    correlation_id?: string;
    idempotency_key?: string;
    chain_sequence?: number;
    chain_hash?: string;
    merkle_index?: number;
    module_signature?: object;
  }
): Promise<Transaction> {
  const [row] = await knex("transactions")
    .insert({
      ...data,
      status: "POSTED",
    })
    .returning("*");
  return row as Transaction;
}

export async function insertTransactionLines(
  transactionId: string,
  lines: Array<{
    account_code: string;
    description?: string;
    debit: string;
    credit: string;
    base_debit: string;
    base_credit: string;
    cost_centre?: string;
    sequence: number;
  }>
): Promise<TransactionLine[]> {
  if (lines.length === 0) return [];

  const rows = await knex("transaction_lines")
    .insert(
      lines.map((line) => ({
        ...line,
        transaction_id: transactionId,
      }))
    )
    .returning("*");

  return rows as TransactionLine[];
}

export async function checkIdempotencyKey(
  key: string
): Promise<Transaction | null> {
  const committed = await knex("transactions")
    .where({ idempotency_key: key })
    .first();

  if (committed) return committed as Transaction;

  const staged = await knex("staging")
    .where({ idempotency_key: key })
    .whereIn("status", ["PENDING", "APPROVED"])
    .first();

  if (staged) {
    return {
      id: staged.id,
      transaction_id: staged.staging_id,
      transaction_type: staged.transaction_type,
      reference: staged.reference,
      date: staged.date,
      period_id: staged.period_id,
      currency: staged.currency,
      exchange_rate: staged.exchange_rate ?? "1",
      base_currency: "",
      counterparty_trading_account_id: null,
      counterparty_contact_id: null,
      description: null,
      source_module: null,
      source_reference: null,
      correlation_id: null,
      idempotency_key: staged.idempotency_key,
      chain_sequence: null,
      chain_hash: null,
      merkle_index: null,
      module_signature: null,
      status: staged.status,
      created_at: staged.created_at,
    } as Transaction;
  }

  return null;
}

import { knex } from "../connection";
import type { TrialBalanceLine } from "../../engine/types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export async function getTrialBalanceLines(
  filters: { period_id?: string; date_to?: string }
): Promise<TrialBalanceLine[]> {
  const query = knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .groupBy("tl.account_code", "a.name", "a.category", "a.type")
    .select(
      "tl.account_code",
      "a.name as account_name",
      "a.category",
      "a.type",
      knex.raw("COALESCE(SUM(tl.debit), 0)::text AS debit"),
      knex.raw("COALESCE(SUM(tl.credit), 0)::text AS credit")
    )
    .havingRaw(
      "COALESCE(SUM(tl.debit), 0) <> 0 OR COALESCE(SUM(tl.credit), 0) <> 0"
    )
    .orderBy("tl.account_code", "asc");

  if (filters.period_id) {
    query.where("t.period_id", filters.period_id);
  }

  if (filters.date_to) {
    query.where("t.date", "<=", filters.date_to);
  }

  const rows = await query;
  return rows as TrialBalanceLine[];
}

export async function getPnLLines(
  filters: { date_from: string; date_to: string }
): Promise<
  Array<{
    account_code: string;
    account_name: string;
    category: string;
    account_type: string | null;
    net: string;
  }>
> {
  const rows = await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .where("t.date", ">=", filters.date_from)
    .where("t.date", "<=", filters.date_to)
    .whereIn("a.category", ["REVENUE", "EXPENSE"])
    .groupBy("tl.account_code", "a.name", "a.category", "a.type")
    .select(
      "tl.account_code",
      "a.name as account_name",
      "a.category",
      "a.type as account_type",
      knex.raw(
        `CASE
           WHEN a.category = 'REVENUE'
             THEN (COALESCE(SUM(tl.credit), 0) - COALESCE(SUM(tl.debit), 0))::text
           ELSE
             (COALESCE(SUM(tl.debit), 0) - COALESCE(SUM(tl.credit), 0))::text
         END AS net`
      )
    )
    .orderBy("tl.account_code", "asc");

  return rows as Array<{
    account_code: string;
    account_name: string;
    category: string;
    account_type: string | null;
    net: string;
  }>;
}

export async function getBalanceSheetLines(
  filters: { date_to: string }
): Promise<
  Array<{
    account_code: string;
    account_name: string;
    category: string;
    account_type: string | null;
    balance: string;
  }>
> {
  const rows = await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .where("t.date", "<=", filters.date_to)
    .whereIn("a.category", ["ASSET", "LIABILITY", "EQUITY"])
    .groupBy("tl.account_code", "a.name", "a.category", "a.type")
    .havingRaw(
      "COALESCE(SUM(tl.debit), 0) <> 0 OR COALESCE(SUM(tl.credit), 0) <> 0"
    )
    .select(
      "tl.account_code",
      "a.name as account_name",
      "a.category",
      "a.type as account_type",
      knex.raw(
        `CASE
           WHEN a.category = 'ASSET'
             THEN (COALESCE(SUM(tl.debit), 0) - COALESCE(SUM(tl.credit), 0))::text
           ELSE
             (COALESCE(SUM(tl.credit), 0) - COALESCE(SUM(tl.debit), 0))::text
         END AS balance`
      )
    )
    .orderBy("tl.account_code", "asc");

  return rows as Array<{
    account_code: string;
    account_name: string;
    category: string;
    account_type: string | null;
    balance: string;
  }>;
}

export async function getAccountLedgerLines(
  accountCode: string,
  filters: {
    date_from?: string;
    date_to?: string;
    period_id?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{
  data: Array<{
    transaction_id: string;
    date: string;
    description: string | null;
    reference: string | null;
    debit: string;
    credit: string;
    transaction_type: string;
    category: string;
    running_net: string;
  }>;
  total: number;
}> {
  const pageSize = Math.min(filters.page_size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  function buildBase() {
    const q = knex("transaction_lines as tl")
      .join("transactions as t", "t.transaction_id", "tl.transaction_id")
      .where("tl.account_code", accountCode)
      .where("t.status", "POSTED");

    if (filters.period_id) q.where("t.period_id", filters.period_id);
    if (filters.date_from) q.where("t.date", ">=", filters.date_from);
    if (filters.date_to) q.where("t.date", "<=", filters.date_to);

    return q;
  }

  const countResult = await buildBase()
    .count<{ count: string }[]>("tl.id as count")
    .first();
  const total = parseInt(
    (countResult as { count: string } | undefined)?.count ?? "0",
    10
  );

  const rows = await buildBase()
    .join("accounts as a", "a.code", "tl.account_code")
    .select(
      "t.transaction_id",
      "t.date",
      "tl.description",
      "t.reference",
      knex.raw("tl.debit::text AS debit"),
      knex.raw("tl.credit::text AS credit"),
      "t.transaction_type",
      "a.category",
      knex.raw(
        "SUM(tl.debit - tl.credit) OVER (" +
        "ORDER BY t.date ASC, t.transaction_id ASC, tl.line_number ASC " +
        "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW" +
        ")::text AS running_net"
      )
    )
    .orderBy([
      { column: "t.date", order: "asc" },
      { column: "t.transaction_id", order: "asc" },
      { column: "tl.line_number", order: "asc" },
    ])
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows as Array<{
      transaction_id: string;
      date: string;
      description: string | null;
      reference: string | null;
      debit: string;
      credit: string;
      transaction_type: string;
      category: string;
      running_net: string;
    }>,
    total,
  };
}

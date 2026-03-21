import { knex } from "../connection";
import type { Account } from "../../engine/types";
import Decimal from "decimal.js";

export async function getAccount(code: string): Promise<Account | null> {
  const row = await knex("accounts")
    .where({ code, active: true })
    .first();
  return row ? (row as Account) : null;
}

export async function listAccounts(
  filters?: { category?: string; active_only?: boolean; search?: string }
): Promise<Account[]> {
  const query = knex("accounts");

  if (filters?.category) {
    query.where("category", filters.category);
  }

  if (filters?.active_only !== undefined) {
    query.where("active", filters.active_only);
  }

  if (filters?.search) {
    const term = `%${filters.search}%`;
    query.where((builder) => {
      builder.whereILike("code", term).orWhereILike("name", term);
    });
  }

  const rows = await query.orderBy("code", "asc");
  return rows as Account[];
}

export async function createAccount(
  data: Omit<Account, "id">
): Promise<Account> {
  const [row] = await knex("accounts")
    .insert(data)
    .returning("*");
  return row as Account;
}

export async function updateAccount(
  code: string,
  data: Partial<Pick<Account, "name" | "active">>
): Promise<Account | null> {
  const [row] = await knex("accounts")
    .where({ code })
    .update(data)
    .returning("*");
  return row ? (row as Account) : null;
}

export async function getAccountBalance(
  code: string,
  filters?: { period_id?: string; date_to?: string }
): Promise<{ debit: string; credit: string; net: string }> {
  const query = knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .where("tl.account_code", code)
    .where("t.status", "POSTED")
    .select(
      knex.raw("COALESCE(SUM(tl.debit), 0)::text AS debit"),
      knex.raw("COALESCE(SUM(tl.credit), 0)::text AS credit")
    )
    .first();

  if (filters?.period_id) {
    query.where("t.period_id", filters.period_id);
  }

  if (filters?.date_to) {
    query.where("t.date", "<=", filters.date_to);
  }

  const row = (await query) as { debit: string; credit: string } | undefined;
  const debit = row?.debit ?? "0";
  const credit = row?.credit ?? "0";
  const net = new Decimal(debit).minus(new Decimal(credit)).toFixed(4);

  return { debit, credit, net };
}

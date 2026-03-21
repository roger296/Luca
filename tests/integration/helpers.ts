import { knex } from "../../src/db/connection";
import * as fs from "fs";
import * as path from "path";

export async function setupTestTenant(): Promise<void> {
  // Ensure company_settings exists (single-tenant: one row, id = 1)
  await knex("company_settings")
    .insert({ id: 1, base_currency: "GBP", company_name: "Test Company", financial_year_start_month: 4 })
    .onConflict("id").merge();

  // Ensure chart of accounts exists
  const accounts = [
    { code: "1000", name: "Bank Current Account",   category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1100", name: "Trade Debtors",           category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1200", name: "VAT Input",               category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "2000", name: "Trade Creditors",         category: "LIABILITY", type: "CURRENT_LIABILITY" },
    { code: "2100", name: "VAT Output",              category: "LIABILITY", type: "CURRENT_LIABILITY" },
    { code: "3100", name: "Retained Earnings",       category: "EQUITY",    type: null },
    { code: "4000", name: "Sales Revenue",           category: "REVENUE",   type: null },
    { code: "5000", name: "Cost of Goods Sold",      category: "EXPENSE",   type: "DIRECT_COSTS" },
    { code: "6700", name: "Bad Debts",               category: "EXPENSE",   type: "OVERHEADS" },
    { code: "7200", name: "FX Gains / Losses",       category: "EXPENSE",   type: "FINANCE_COSTS" },
  ];
  for (const acct of accounts) {
    await knex("accounts").insert({ ...acct, active: true })
      .onConflict("code").ignore();
  }

  // Ensure transaction type mappings exist
  await knex("transaction_type_mappings").insert({
    transaction_type: "CUSTOMER_INVOICE",
    debit_rules: JSON.stringify([{ account_code: "1100", amount_source: "gross", description_template: "Trade debtors - {counterparty}", allow_override: false }]),
    credit_rules: JSON.stringify([
      { account_code: "4000", amount_source: "net", description_template: "Sales - {description}", allow_override: true },
      { account_code: "2100", amount_source: "tax", description_template: "VAT output", allow_override: false },
    ]),
    is_active: true,
  }).onConflict("transaction_type").ignore();

  await knex("transaction_type_mappings").insert({
    transaction_type: "MANUAL_JOURNAL",
    debit_rules: JSON.stringify([]),
    credit_rules: JSON.stringify([]),
    is_active: true,
  }).onConflict("transaction_type").ignore();

  // Ensure approval rule exists (auto-approve all for tests)
  const existing = await knex("approval_rules").first();
  if (!existing) {
    await knex("approval_rules").insert({
      transaction_type: null,
      auto_approve_below: "999999999.00",
      required_approver_role: null,
      approval_roles: [],
      required_approvals: 1,
      is_active: true,
    });
  }

  // Ensure test period exists
  await knex("periods").insert({
    period_id: "2026-03",
    status: "OPEN",
    data_flag: "PROVISIONAL",
  }).onConflict("period_id").ignore();

  // Ensure registered module exists for tests
  await knex("registered_modules").insert({
    module_id: "test-module",
    display_name: "Test Module",
    public_key: null,
    allowed_transaction_types: ["CUSTOMER_INVOICE", "MANUAL_JOURNAL", "SUPPLIER_INVOICE", "CUSTOMER_PAYMENT", "FX_REVALUATION"],
    is_active: true,
  }).onConflict("module_id").ignore();
}

export async function cleanupTestTenant(): Promise<void> {
  await knex("transaction_lines").delete();
  await knex("transactions").delete();
  await knex("staging").delete();
  await knex("exchange_rates").delete();
  await knex("approval_delegations").delete();
  await knex("sub_ledger_reconciliations").delete();
  // Delete webhook deliveries before subscriptions (FK dependency)
  await knex("webhook_deliveries").delete();
  await knex("webhook_subscriptions").delete();
  // Clean chain files so tests never see state from a previous run
  const chainsDir = path.join(process.cwd(), "chains");
  if (fs.existsSync(chainsDir)) {
    for (const f of fs.readdirSync(chainsDir)) {
      if (!f.endsWith(".chain.jsonl")) continue;
      const fp = path.join(chainsDir, f);
      try { fs.chmodSync(fp, 0o644); } catch { /* ignore on Windows */ }
      try { fs.unlinkSync(fp); } catch { /* ignore */ }
    }
  }
}

export async function closeKnex(): Promise<void> {
  await knex.destroy();
}

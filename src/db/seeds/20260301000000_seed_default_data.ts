import type { Knex } from "knex";

// Seed file — populates all reference data for a single-tenant GL instance.
// Idempotent: uses onConflict().ignore() throughout (except approval_rules which has no
// natural unique key and is wiped + re-inserted on every run).

const CURRENT_PERIOD = "2026-03";

const ALL_TRANSACTION_TYPES = [
  "CUSTOMER_INVOICE", "CUSTOMER_CREDIT_NOTE", "CUSTOMER_PAYMENT", "BAD_DEBT_WRITE_OFF",
  "SUPPLIER_INVOICE", "SUPPLIER_CREDIT_NOTE", "SUPPLIER_PAYMENT",
  "STOCK_RECEIPT", "STOCK_DISPATCH", "STOCK_WRITE_OFF", "STOCK_TRANSFER", "STOCK_REVALUATION",
  "BANK_RECEIPT", "BANK_PAYMENT", "BANK_TRANSFER",
  "MANUAL_JOURNAL", "PRIOR_PERIOD_ADJUSTMENT", "PERIOD_END_ACCRUAL",
  "PREPAYMENT_RECOGNITION", "DEPRECIATION", "FX_REVALUATION", "YEAR_END_CLOSE",
];

export async function seed(knex: Knex): Promise<void> {
  // 1. Company settings (single row — id=1 enforced by CHECK constraint)
  await knex("company_settings").insert({
    id: 1,
    company_name: "My Company",
    base_currency: "GBP",
    financial_year_start_month: 4,
    settings: JSON.stringify({}),
  }).onConflict("id").ignore();

  // 2. Chart of accounts (full V1 chart)
  const accounts = [
    { code: "1000", name: "Bank Current Account",       category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1050", name: "Bank Deposit Account",        category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1100", name: "Trade Debtors",               category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1150", name: "Other Debtors",               category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1200", name: "VAT Input (Recoverable)",     category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1300", name: "Stock",                       category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1350", name: "Goods Received Not Invoiced", category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1400", name: "Prepayments",                 category: "ASSET",     type: "CURRENT_ASSET" },
    { code: "1500", name: "Fixed Assets - Cost",         category: "ASSET",     type: "FIXED_ASSET" },
    { code: "1510", name: "Fixed Assets - Accum Depn",   category: "ASSET",     type: "FIXED_ASSET" },
    { code: "2000", name: "Trade Creditors",             category: "LIABILITY", type: "CURRENT_LIABILITY" },
    { code: "2050", name: "Other Creditors",             category: "LIABILITY", type: "CURRENT_LIABILITY" },
    { code: "2100", name: "VAT Output",                  category: "LIABILITY", type: "CURRENT_LIABILITY" },
    { code: "2150", name: "Accruals",                    category: "LIABILITY", type: "CURRENT_LIABILITY" },
    { code: "2200", name: "PAYE/NI Payable",             category: "LIABILITY", type: "CURRENT_LIABILITY" },
    { code: "3000", name: "Share Capital",               category: "EQUITY",    type: null },
    { code: "3100", name: "Retained Earnings",           category: "EQUITY",    type: null },
    { code: "3200", name: "Revaluation Reserve",         category: "EQUITY",    type: null },
    { code: "4000", name: "Sales Revenue - Trade",       category: "REVENUE",   type: null },
    { code: "4100", name: "Sales Revenue - Other",       category: "REVENUE",   type: null },
    { code: "4200", name: "Other Income",                category: "REVENUE",   type: "OTHER_INCOME" },
    { code: "5000", name: "Cost of Goods Sold",          category: "EXPENSE",   type: "DIRECT_COSTS" },
    { code: "5100", name: "Purchases - Raw Materials",   category: "EXPENSE",   type: "DIRECT_COSTS" },
    { code: "5200", name: "Purchase Price Variance",     category: "EXPENSE",   type: "DIRECT_COSTS" },
    { code: "6000", name: "Wages and Salaries",          category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6100", name: "Rent and Rates",              category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6200", name: "Office Supplies",             category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6300", name: "Professional Fees",           category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6400", name: "Travel and Subsistence",      category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6500", name: "Marketing and Advertising",   category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6600", name: "Depreciation",                category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6700", name: "Bad Debts",                   category: "EXPENSE",   type: "OVERHEADS" },
    { code: "6800", name: "Stock Write-Off",             category: "EXPENSE",   type: "OVERHEADS" },
    { code: "7000", name: "Bank Interest Received",      category: "REVENUE",   type: "OTHER_INCOME" },
    { code: "7100", name: "Bank Charges",                category: "EXPENSE",   type: "FINANCE_COSTS" },
    { code: "7200", name: "FX Gains / Losses",           category: "EXPENSE",   type: "FINANCE_COSTS" },
  ];
  for (const acct of accounts) {
    await knex("accounts").insert({ ...acct, active: true }).onConflict("code").ignore();
  }

  // 3. Transaction type mappings (all V1 types)
  type MappingRule = {
    account_code: string;
    amount_source: string;
    description_template: string;
    allow_override: boolean;
  };
  const mappings: Array<{
    transaction_type: string;
    debit_rules: MappingRule[];
    credit_rules: MappingRule[];
  }> = [
    {
      transaction_type: "CUSTOMER_INVOICE",
      debit_rules: [
        { account_code: "1100", amount_source: "gross", description_template: "Trade debtors - {counterparty}", allow_override: false },
      ],
      credit_rules: [
        { account_code: "4000", amount_source: "net", description_template: "Sales revenue - {description}", allow_override: true },
        { account_code: "2100", amount_source: "tax", description_template: "VAT output tax", allow_override: false },
      ],
    },
    {
      transaction_type: "CUSTOMER_CREDIT_NOTE",
      debit_rules: [
        { account_code: "4000", amount_source: "net", description_template: "Sales revenue reversed - {description}", allow_override: true },
        { account_code: "2100", amount_source: "tax", description_template: "VAT output reversed", allow_override: false },
      ],
      credit_rules: [
        { account_code: "1100", amount_source: "gross", description_template: "Trade debtors credit note - {counterparty}", allow_override: false },
      ],
    },
    {
      transaction_type: "CUSTOMER_PAYMENT",
      debit_rules: [{ account_code: "1000", amount_source: "gross", description_template: "Bank receipt - {counterparty}", allow_override: true }],
      credit_rules: [{ account_code: "1100", amount_source: "gross", description_template: "Debtors cleared - {counterparty}", allow_override: false }],
    },
    {
      transaction_type: "BAD_DEBT_WRITE_OFF",
      debit_rules: [{ account_code: "6700", amount_source: "gross", description_template: "Bad debt write-off - {counterparty}", allow_override: false }],
      credit_rules: [{ account_code: "1100", amount_source: "gross", description_template: "Trade debtors written off - {counterparty}", allow_override: false }],
    },
    {
      transaction_type: "SUPPLIER_INVOICE",
      debit_rules: [
        { account_code: "5100", amount_source: "net", description_template: "Purchases - {description}", allow_override: true },
        { account_code: "1200", amount_source: "tax", description_template: "VAT input tax", allow_override: false },
      ],
      credit_rules: [
        { account_code: "2000", amount_source: "gross", description_template: "Trade creditors - {counterparty}", allow_override: false },
      ],
    },
    {
      transaction_type: "SUPPLIER_CREDIT_NOTE",
      debit_rules: [
        { account_code: "2000", amount_source: "gross", description_template: "Trade creditors credit note - {counterparty}", allow_override: false },
      ],
      credit_rules: [
        { account_code: "5100", amount_source: "net", description_template: "Purchases reversed - {description}", allow_override: true },
        { account_code: "1200", amount_source: "tax", description_template: "VAT input reversed", allow_override: false },
      ],
    },
    {
      transaction_type: "SUPPLIER_PAYMENT",
      debit_rules: [{ account_code: "2000", amount_source: "gross", description_template: "Creditors paid - {counterparty}", allow_override: false }],
      credit_rules: [{ account_code: "1000", amount_source: "gross", description_template: "Bank payment - {counterparty}", allow_override: true }],
    },
    {
      transaction_type: "STOCK_RECEIPT",
      debit_rules: [{ account_code: "1300", amount_source: "net", description_template: "Stock received - {description}", allow_override: false }],
      credit_rules: [{ account_code: "1350", amount_source: "net", description_template: "Goods received not invoiced", allow_override: false }],
    },
    {
      transaction_type: "STOCK_DISPATCH",
      debit_rules: [{ account_code: "5000", amount_source: "net", description_template: "Cost of goods sold - {description}", allow_override: false }],
      credit_rules: [{ account_code: "1300", amount_source: "net", description_template: "Stock dispatched - {description}", allow_override: false }],
    },
    {
      transaction_type: "STOCK_WRITE_OFF",
      debit_rules: [{ account_code: "6800", amount_source: "net", description_template: "Stock write-off - {description}", allow_override: false }],
      credit_rules: [{ account_code: "1300", amount_source: "net", description_template: "Stock written off - {description}", allow_override: false }],
    },
    {
      transaction_type: "STOCK_TRANSFER",
      debit_rules: [{ account_code: "1300", amount_source: "net", description_template: "Stock transfer in - {description}", allow_override: true }],
      credit_rules: [{ account_code: "1300", amount_source: "net", description_template: "Stock transfer out - {description}", allow_override: true }],
    },
    {
      transaction_type: "STOCK_REVALUATION",
      debit_rules: [{ account_code: "1300", amount_source: "net", description_template: "Stock revaluation - {description}", allow_override: true }],
      credit_rules: [{ account_code: "3200", amount_source: "net", description_template: "Revaluation reserve", allow_override: true }],
    },
    {
      transaction_type: "BANK_RECEIPT",
      debit_rules: [{ account_code: "1000", amount_source: "gross", description_template: "Bank receipt - {description}", allow_override: true }],
      credit_rules: [],
    },
    {
      transaction_type: "BANK_PAYMENT",
      debit_rules: [],
      credit_rules: [{ account_code: "1000", amount_source: "gross", description_template: "Bank payment - {description}", allow_override: true }],
    },
    {
      transaction_type: "BANK_TRANSFER",
      debit_rules: [{ account_code: "1000", amount_source: "gross", description_template: "Transfer in - {description}", allow_override: true }],
      credit_rules: [{ account_code: "1000", amount_source: "gross", description_template: "Transfer out - {description}", allow_override: true }],
    },
    {
      transaction_type: "MANUAL_JOURNAL",
      debit_rules: [],
      credit_rules: [],
    },
    {
      transaction_type: "PRIOR_PERIOD_ADJUSTMENT",
      debit_rules: [],
      credit_rules: [],
    },
    {
      transaction_type: "PERIOD_END_ACCRUAL",
      debit_rules: [{ account_code: "6000", amount_source: "net", description_template: "Accrual - {description}", allow_override: true }],
      credit_rules: [{ account_code: "2150", amount_source: "net", description_template: "Accrued liabilities - {description}", allow_override: false }],
    },
    {
      transaction_type: "PREPAYMENT_RECOGNITION",
      debit_rules: [{ account_code: "6000", amount_source: "net", description_template: "Prepayment recognised - {description}", allow_override: true }],
      credit_rules: [{ account_code: "1400", amount_source: "net", description_template: "Prepayment cleared - {description}", allow_override: false }],
    },
    {
      transaction_type: "DEPRECIATION",
      debit_rules: [{ account_code: "6600", amount_source: "net", description_template: "Depreciation charge - {description}", allow_override: false }],
      credit_rules: [{ account_code: "1510", amount_source: "net", description_template: "Accumulated depreciation - {description}", allow_override: false }],
    },
    {
      transaction_type: "FX_REVALUATION",
      debit_rules: [],
      credit_rules: [{ account_code: "7200", amount_source: "net", description_template: "FX gain/loss - {description}", allow_override: true }],
    },
    {
      transaction_type: "YEAR_END_CLOSE",
      debit_rules: [],
      credit_rules: [{ account_code: "3100", amount_source: "net", description_template: "Year-end close to retained earnings", allow_override: false }],
    },
  ];
  for (const m of mappings) {
    await knex("transaction_type_mappings").insert({
      transaction_type: m.transaction_type,
      debit_rules: JSON.stringify(m.debit_rules),
      credit_rules: JSON.stringify(m.credit_rules),
      is_active: true,
    }).onConflict("transaction_type").ignore();
  }

  // 4. Approval rules — wipe and re-insert (no natural unique key).
  await knex("approval_rules").delete();
  await knex("approval_rules").insert([
    {
      transaction_type: null,
      auto_approve_below: "500.00",
      required_approver_role: null,
      approval_roles: [],
      required_approvals: 1,
      is_active: true,
    },
    {
      transaction_type: null,
      auto_approve_below: null,
      required_approver_role: "FINANCE_MANAGER",
      approval_roles: ["FINANCE_MANAGER"],
      required_approvals: 1,
      is_active: true,
    },
  ]);

  // 5. Current open period
  await knex("periods").insert({
    period_id: CURRENT_PERIOD,
    status: "OPEN",
    data_flag: "PROVISIONAL",
  }).onConflict("period_id").ignore();

  // 6. General Ledger module registration
  await knex("registered_modules").insert({
    module_id: "general-ledger",
    display_name: "General Ledger",
    public_key: null,
    allowed_transaction_types: ALL_TRANSACTION_TYPES,
    is_active: true,
  }).onConflict("module_id").ignore();
}

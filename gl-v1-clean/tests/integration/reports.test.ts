import { knex } from "../../src/db/connection";
import { setupTestTenant, cleanupTestTenant, closeKnex } from "./helpers";
import {
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getCashFlow,
} from "../../src/engine/reports";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Insert a minimal POSTED transaction directly, bypassing the posting engine. */
async function insertPostedTx(
  txId: string,
  date: string,
  periodId: string,
  lines: Array<{
    account_code: string;
    description: string;
    debit: string;
    credit: string;
  }>
): Promise<void> {
  await knex("transactions").insert({
    transaction_id: txId,
    transaction_type: "MANUAL_JOURNAL",
    date,
    period_id: periodId,
    currency: "GBP",
    base_currency: "GBP",
    exchange_rate: "1.00000000",
    status: "POSTED",
  });

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    await knex("transaction_lines").insert({
      transaction_id: txId,
      account_code: l.account_code,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      base_debit: l.debit,
      base_credit: l.credit,
      line_number: i + 1,
    });
  }
}

// Shorthand: insert into the default test period (2026-03)
// transaction_id is VARCHAR(30) so keep IDs ≤ 30 chars
let txSeq = 0;
function nextTxId(): string {
  return `RPT-${String(++txSeq).padStart(6, "0")}`;
}

async function tx(
  date: string,
  lines: Array<{ account_code: string; description: string; debit: string; credit: string }>
): Promise<void> {
  return insertPostedTx(nextTxId(), date, "2026-03", lines);
}

// Reset the test period data_flag to PROVISIONAL (guards against cross-test contamination)
async function resetPeriodFlag(): Promise<void> {
  await knex("periods").where({ period_id: "2026-03" }).update({ data_flag: "PROVISIONAL" });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(setupTestTenant);
afterEach(cleanupTestTenant);
afterAll(closeKnex);

// ─────────────────────────────────────────────────────────────────────────────
// Trial Balance
// ─────────────────────────────────────────────────────────────────────────────

describe("Reports: Trial Balance", () => {
  beforeEach(resetPeriodFlag);

  it("returns a balanced trial balance after a double-entry transaction", async () => {
    await tx("2026-03-10", [
      { account_code: "1000", description: "Bank debit",           debit: "1000.00", credit: "0" },
      { account_code: "3100", description: "Retained earnings cr", debit: "0",       credit: "1000.00" },
    ]);

    const report = await getTrialBalance({ period_id: "2026-03" });

    expect(report.balanced).toBe(true);
    expect(report.data_flag).toBe("PROVISIONAL");

    const bankLine = report.lines.find((l) => l.account_code === "1000");
    expect(bankLine).toBeDefined();
    expect(parseFloat(bankLine!.debit)).toBeCloseTo(1000, 2);
    expect(bankLine!.credit).toBe("0.0000");
  });

  it("reflects AUTHORITATIVE data_flag when period is closed", async () => {
    await tx("2026-03-10", [
      { account_code: "1000", description: "Bank", debit: "500.00", credit: "0" },
      { account_code: "3100", description: "Equity", debit: "0", credit: "500.00" },
    ]);

    await knex("periods")
      .where({ period_id: "2026-03" })
      .update({ data_flag: "AUTHORITATIVE" });

    const report = await getTrialBalance({ period_id: "2026-03" });
    expect(report.data_flag).toBe("AUTHORITATIVE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profit & Loss
// ─────────────────────────────────────────────────────────────────────────────

describe("Reports: Profit & Loss", () => {
  beforeEach(resetPeriodFlag);

  it("shows revenue and net profit from a customer invoice posting", async () => {
    // Dr Debtors 120, Cr Revenue 100, Cr VAT Output 20
    await tx("2026-03-10", [
      { account_code: "1100", description: "Trade debtors", debit: "120.00", credit: "0" },
      { account_code: "4000", description: "Sales revenue",  debit: "0",      credit: "100.00" },
      { account_code: "2100", description: "VAT output",     debit: "0",      credit: "20.00" },
    ]);

    const report = await getProfitAndLoss({ period_id: "2026-03" });

    const revenueSection = report.sections.find((s) => s.category === "REVENUE");
    expect(revenueSection).toBeDefined();
    const revAccount = revenueSection!.accounts.find((a) => a.account_code === "4000");
    expect(revAccount).toBeDefined();
    expect(parseFloat(revAccount!.amount)).toBeCloseTo(100, 2);

    expect(parseFloat(report.gross_profit)).toBeCloseTo(100, 2);
    expect(parseFloat(report.net_profit)).toBeCloseTo(100, 2);
  });

  it("deducts cost of sales from gross profit", async () => {
    // Revenue: Dr Debtors 120, Cr Revenue 100, Cr VAT Output 20
    await tx("2026-03-10", [
      { account_code: "1100", description: "Trade debtors", debit: "120.00", credit: "0" },
      { account_code: "4000", description: "Sales revenue",  debit: "0",      credit: "100.00" },
      { account_code: "2100", description: "VAT output",     debit: "0",      credit: "20.00" },
    ]);
    // COGS: Dr 5000 50, Cr Trade Creditors 50
    await tx("2026-03-10", [
      { account_code: "5000", description: "Cost of goods sold", debit: "50.00", credit: "0" },
      { account_code: "2000", description: "Trade creditors",    debit: "0",     credit: "50.00" },
    ]);

    const report = await getProfitAndLoss({ period_id: "2026-03" });

    expect(parseFloat(report.gross_profit)).toBeCloseTo(50, 2);  // 100 revenue - 50 COGS
    expect(parseFloat(report.net_profit)).toBeCloseTo(50, 2);
  });

  it("separates overhead expenses below gross profit", async () => {
    // Revenue
    await tx("2026-03-10", [
      { account_code: "1100", description: "Debtors",       debit: "100.00", credit: "0" },
      { account_code: "4000", description: "Sales revenue",  debit: "0",      credit: "100.00" },
    ]);
    // Overhead: Bad Debts 6700 (type = OVERHEADS)
    await tx("2026-03-15", [
      { account_code: "6700", description: "Bad debt write-off", debit: "30.00", credit: "0" },
      { account_code: "1100", description: "Debtors reduced",    debit: "0",     credit: "30.00" },
    ]);

    const report = await getProfitAndLoss({ period_id: "2026-03" });

    expect(parseFloat(report.gross_profit)).toBeCloseTo(100, 2);   // no COGS
    expect(parseFloat(report.total_overheads)).toBeCloseTo(30, 2);
    expect(parseFloat(report.net_profit)).toBeCloseTo(70, 2);      // 100 - 30
  });

  it("returns PROVISIONAL data_flag for an open period", async () => {
    const report = await getProfitAndLoss({ period_id: "2026-03" });
    expect(report.data_flag).toBe("PROVISIONAL");
  });

  it("returns AUTHORITATIVE data_flag after period is marked authoritative", async () => {
    await knex("periods")
      .where({ period_id: "2026-03" })
      .update({ data_flag: "AUTHORITATIVE" });

    const report = await getProfitAndLoss({ period_id: "2026-03" });
    expect(report.data_flag).toBe("AUTHORITATIVE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Balance Sheet
// ─────────────────────────────────────────────────────────────────────────────

describe("Reports: Balance Sheet", () => {
  beforeEach(resetPeriodFlag);

  it("shows assets = liabilities + equity (balanced) after a pure BS transaction", async () => {
    // Dr Bank 1000, Cr Retained Earnings 1000 — no P&L accounts, always balanced
    await tx("2026-03-10", [
      { account_code: "1000", description: "Bank",              debit: "1000.00", credit: "0" },
      { account_code: "3100", description: "Retained earnings", debit: "0",       credit: "1000.00" },
    ]);

    const report = await getBalanceSheet({ period_id: "2026-03" });

    expect(report.balanced).toBe(true);
    expect(parseFloat(report.total_assets)).toBeCloseTo(1000, 2);
    expect(parseFloat(report.total_liabilities_and_equity)).toBeCloseTo(1000, 2);

    const assetSection = report.assets.find((s) => s.category === "CURRENT_ASSET");
    expect(assetSection).toBeDefined();
    const bankLine = assetSection!.accounts.find((a) => a.account_code === "1000");
    expect(bankLine).toBeDefined();
    expect(parseFloat(bankLine!.amount)).toBeCloseTo(1000, 2);
  });

  it("categorises liability accounts correctly", async () => {
    // Dr Bank 500, Cr Trade Creditors 500 (current liability)
    await tx("2026-03-10", [
      { account_code: "1000", description: "Bank",            debit: "500.00", credit: "0" },
      { account_code: "2000", description: "Trade creditors", debit: "0",      credit: "500.00" },
    ]);

    const report = await getBalanceSheet({ period_id: "2026-03" });

    const liabSection = report.liabilities.find((s) => s.category === "CURRENT_LIABILITY");
    expect(liabSection).toBeDefined();
    const credLine = liabSection!.accounts.find((a) => a.account_code === "2000");
    expect(credLine).toBeDefined();
    expect(parseFloat(credLine!.amount)).toBeCloseTo(500, 2);
    expect(report.balanced).toBe(true);
  });

  it("reflects AUTHORITATIVE data_flag when period is closed", async () => {
    await knex("periods")
      .where({ period_id: "2026-03" })
      .update({ data_flag: "AUTHORITATIVE" });

    const report = await getBalanceSheet({ period_id: "2026-03" });
    expect(report.data_flag).toBe("AUTHORITATIVE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cash Flow
// ─────────────────────────────────────────────────────────────────────────────

describe("Reports: Cash Flow", () => {
  beforeEach(resetPeriodFlag);

  it("closing cash matches the bank account balance at period end", async () => {
    await tx("2026-03-05", [
      { account_code: "1000", description: "Bank receipt",      debit: "800.00", credit: "0" },
      { account_code: "3100", description: "Retained earnings", debit: "0",      credit: "800.00" },
    ]);

    const report = await getCashFlow({ period_id: "2026-03" });

    expect(parseFloat(report.closing_cash)).toBeCloseTo(800, 2);
    expect(parseFloat(report.opening_cash)).toBeCloseTo(0, 2);
    expect(parseFloat(report.net_change_in_cash)).toBeCloseTo(800, 2);
  });

  it("opening cash reflects bank balance from transactions before the period", async () => {
    // Ensure the prior period row exists
    await knex("periods").insert({
      period_id: "2026-02",
      status: "HARD_CLOSE",
      data_flag: "AUTHORITATIVE",
    }).onConflict("period_id").ignore();

    // Prior-period bank balance
    await insertPostedTx(nextTxId(), "2026-02-28", "2026-02", [
      { account_code: "1000", description: "Prior bank balance", debit: "200.00", credit: "0" },
      { account_code: "3100", description: "Prior equity",       debit: "0",      credit: "200.00" },
    ]);

    // Current period bank receipt
    await tx("2026-03-10", [
      { account_code: "1000", description: "Current bank credit", debit: "300.00", credit: "0" },
      { account_code: "3100", description: "Current equity",      debit: "0",      credit: "300.00" },
    ]);

    const report = await getCashFlow({ period_id: "2026-03" });

    expect(parseFloat(report.opening_cash)).toBeCloseTo(200, 2);
    expect(parseFloat(report.closing_cash)).toBeCloseTo(500, 2);   // 200 + 300
    expect(parseFloat(report.net_change_in_cash)).toBeCloseTo(300, 2);
  });

  it("net profit flows into operating activities; zero debtors change is omitted", async () => {
    // Invoice raised: Dr Debtors 100, Cr Revenue 100
    await tx("2026-03-10", [
      { account_code: "1100", description: "Trade debtors", debit: "100.00", credit: "0" },
      { account_code: "4000", description: "Sales revenue",  debit: "0",      credit: "100.00" },
    ]);
    // Cash collection: Dr Bank 100, Cr Debtors 100 (debtors back to zero)
    await tx("2026-03-15", [
      { account_code: "1000", description: "Bank receipt",    debit: "100.00", credit: "0" },
      { account_code: "1100", description: "Debtors cleared", debit: "0",     credit: "100.00" },
    ]);

    const report = await getCashFlow({ period_id: "2026-03" });

    expect(parseFloat(report.operating_activities.net_profit)).toBeCloseTo(100, 2);
    // Net debtors change = 0 → omitted from working_capital_changes
    const debtorsWc = report.operating_activities.working_capital_changes.find(
      (c) => c.description.includes("debtors")
    );
    expect(debtorsWc).toBeUndefined();

    expect(parseFloat(report.closing_cash)).toBeCloseTo(100, 2);
  });

  it("working capital increase in debtors appears as operating cash outflow", async () => {
    // Invoice raised but NOT yet collected: debtors +100, no bank movement
    await tx("2026-03-10", [
      { account_code: "1100", description: "Trade debtors", debit: "100.00", credit: "0" },
      { account_code: "4000", description: "Sales revenue",  debit: "0",      credit: "100.00" },
    ]);

    const report = await getCashFlow({ period_id: "2026-03" });

    expect(parseFloat(report.operating_activities.net_profit)).toBeCloseTo(100, 2);

    const debtorsWc = report.operating_activities.working_capital_changes.find(
      (c) => c.description.includes("debtors")
    );
    expect(debtorsWc).toBeDefined();
    expect(parseFloat(debtorsWc!.amount)).toBeCloseTo(-100, 2); // outflow: debtors increased

    expect(parseFloat(report.operating_activities.net_cash_from_operations)).toBeCloseTo(0, 2);
    expect(parseFloat(report.closing_cash)).toBeCloseTo(0, 2);  // no bank movement
  });

  it("returns the correct period date range", async () => {
    const report = await getCashFlow({ period_id: "2026-03" });
    expect(report.date_from).toBe("2026-03-01");
    expect(report.date_to).toBe("2026-03-31");
    expect(report.period_id).toBe("2026-03");
  });

  it("returns PROVISIONAL data_flag for an open period", async () => {
    const report = await getCashFlow({ period_id: "2026-03" });
    expect(report.data_flag).toBe("PROVISIONAL");
  });

  it("returns AUTHORITATIVE data_flag after period is marked authoritative", async () => {
    await knex("periods")
      .where({ period_id: "2026-03" })
      .update({ data_flag: "AUTHORITATIVE" });

    const report = await getCashFlow({ period_id: "2026-03" });
    expect(report.data_flag).toBe("AUTHORITATIVE");
  });
});

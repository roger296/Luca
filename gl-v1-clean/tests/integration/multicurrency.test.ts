import { postTransaction } from "../../src/engine/posting";
import { generateFxRevaluations } from "../../src/engine/currency";
import * as exchangeRatesDb from "../../src/db/queries/exchange_rates";
import { knex } from "../../src/db/connection";
import {
  ExchangeRateRequiredError,
  ValidationError,
} from "../../src/engine/types";
import {
  setupTestTenant,
  cleanupTestTenant,
  closeKnex,
} from "./helpers";

// Shared lifecycle: one DB connection, one setup, cleanup after each test.
beforeAll(async () => { await setupTestTenant(); });
afterEach(async () => { await cleanupTestTenant(); });
afterAll(async () => { await closeKnex(); });

// ── Multi-currency posting ───────────────────────────────────────────────────

describe("Multi-currency posting", () => {
  it("posts a EUR transaction and stores both EUR and GBP amounts", async () => {
    const result = await postTransaction({
      transaction_type: "CUSTOMER_INVOICE",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "EUR",
      exchange_rate: "0.86",
      reference: "INV-EUR-001",
      description: "EUR invoice test",
      lines: [
        { description: "Widget sale", net_amount: "1000.00", tax_amount: "200.00" },
      ],
      source: { module_id: "test-module", module_reference: "EUR-001" },
      idempotency_key: "mc-eur-001",
    });
    expect(result.status).toBe("POSTED");
    const tx = (await knex("transactions")
      .where({ transaction_id: result.transaction_id })
      .first()) as Record<string, unknown>;
    expect(tx).toBeDefined();
    expect(tx["currency"]).toBe("EUR");
    expect(tx["base_currency"]).toBe("GBP");
    const lines = (await knex("transaction_lines")
      .where({ transaction_id: result.transaction_id })
      .orderBy("line_number")) as Record<string, unknown>[];
    const debitLine = lines.find((l) => parseFloat(String(l["debit"])) > 0);
    expect(debitLine).toBeDefined();
    expect(parseFloat(String(debitLine!["debit"]))).toBeCloseTo(1200, 2);
    expect(parseFloat(String(debitLine!["base_debit"]))).toBeCloseTo(1032, 2);
    const creditLines = lines.filter((l) => parseFloat(String(l["credit"])) > 0);
    expect(creditLines.length).toBe(2);
    const totalCredit = creditLines.reduce((a, l) => a + parseFloat(String(l["credit"])), 0);
    expect(totalCredit).toBeCloseTo(1200, 2);
    const totalBaseCredit = creditLines.reduce((a, l) => a + parseFloat(String(l["base_credit"])), 0);
    expect(totalBaseCredit).toBeCloseTo(1032, 2);
  });

  it("posts a GBP transaction with base amounts equal to transaction amounts", async () => {
    const result = await postTransaction({
      transaction_type: "CUSTOMER_INVOICE",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "GBP",
      reference: "INV-GBP-001",
      description: "GBP invoice test",
      lines: [
        { description: "Widget sale", net_amount: "500.00", tax_amount: "100.00" },
      ],
      source: { module_id: "test-module", module_reference: "GBP-001" },
      idempotency_key: "mc-gbp-001",
    });
    expect(result.status).toBe("POSTED");
    const lines = (await knex("transaction_lines")
      .where({ transaction_id: result.transaction_id })
      .orderBy("line_number")) as Record<string, unknown>[];
    for (const line of lines) {
      expect(parseFloat(String(line["debit"]))).toBeCloseTo(
        parseFloat(String(line["base_debit"])), 4);
      expect(parseFloat(String(line["credit"]))).toBeCloseTo(
        parseFloat(String(line["base_credit"])), 4);
    }
  });

  it("rejects a foreign-currency transaction without exchange_rate", async () => {
    await expect(postTransaction({
      transaction_type: "CUSTOMER_INVOICE",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "EUR",
      reference: "INV-NO-RATE",
      lines: [{ description: "Widget", net_amount: "100.00", tax_amount: "20.00" }],
      source: { module_id: "test-module" },
      idempotency_key: "mc-no-rate-001",
    })).rejects.toThrow(ExchangeRateRequiredError);
  });

  it("rejects a transaction with a non-positive exchange rate", async () => {
    await expect(postTransaction({
      transaction_type: "CUSTOMER_INVOICE",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "EUR",
      exchange_rate: "-0.5",
      reference: "INV-NEG-RATE",
      lines: [{ description: "Widget", net_amount: "100.00", tax_amount: "20.00" }],
      source: { module_id: "test-module" },
      idempotency_key: "mc-neg-rate-001",
    })).rejects.toThrow(ValidationError);
  });

  it("both EUR and GBP amounts independently balance on a manual journal", async () => {
    const result = await postTransaction({
      transaction_type: "MANUAL_JOURNAL",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "EUR",
      exchange_rate: "0.86",
      reference: "MJ-EUR-001",
      description: "EUR manual journal dual balance",
      lines: [
        { account_code: "1000", description: "Bank debit EUR", net_amount: "1000.00" },
        { account_code: "3100", description: "Equity credit EUR", net_amount: "-1000.00" },
      ],
      source: { module_id: "test-module" },
      idempotency_key: "mc-dual-001",
    });
    expect(result.status).toBe("POSTED");
    const lines = (await knex("transaction_lines")
      .where({ transaction_id: result.transaction_id })
      .orderBy("line_number")) as Record<string, unknown>[];
    let eurDebits = 0, eurCredits = 0, gbpDebits = 0, gbpCredits = 0;
    for (const line of lines) {
      eurDebits  += parseFloat(String(line["debit"]));
      eurCredits += parseFloat(String(line["credit"]));
      gbpDebits  += parseFloat(String(line["base_debit"]));
      gbpCredits += parseFloat(String(line["base_credit"]));
    }
    expect(eurDebits).toBeCloseTo(eurCredits, 4);
    expect(gbpDebits).toBeCloseTo(gbpCredits, 4);
  });
});

// ── Exchange rate management ─────────────────────────────────────────────────

describe("Exchange rate management", () => {
  it("stores and retrieves an exchange rate", async () => {
    await exchangeRatesDb.setRate("EUR", "GBP", "0.8600", "2026-03-01", "manual");
    const rate = await exchangeRatesDb.getRate("EUR", "GBP", "2026-03-10");
    expect(rate).not.toBeNull();
    expect(parseFloat(rate!)).toBeCloseTo(0.86, 4);
  });

  it("upserts: same date replaces the rate", async () => {
    await exchangeRatesDb.setRate("EUR", "GBP", "0.8600", "2026-03-01");
    await exchangeRatesDb.setRate("EUR", "GBP", "0.8800", "2026-03-01");
    const rate = await exchangeRatesDb.getRate("EUR", "GBP", "2026-03-10");
    expect(rate).not.toBeNull();
    expect(parseFloat(rate!)).toBeCloseTo(0.88, 4);
  });

  it("returns 1 for same-currency lookup", async () => {
    const rate = await exchangeRatesDb.getRate("GBP", "GBP", "2026-03-10");
    expect(rate).toBe("1");
  });
});

// ── FX Revaluation ──────────────────────────────────────────────────────────

describe("FX Revaluation", () => {
  it("generates a revaluation when EUR rate changes 0.86->0.88 on an ASSET account", async () => {
    await postTransaction({
      transaction_type: "MANUAL_JOURNAL",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "EUR",
      exchange_rate: "0.86",
      reference: "EUR-DEBTOR-SETUP",
      description: "Setup EUR debtors",
      lines: [
        { account_code: "1100", description: "EUR Trade Debtors", net_amount: "1000.00" },
        { account_code: "3100", description: "Retained Earnings", net_amount: "-1000.00" },
      ],
      source: { module_id: "test-module" },
      idempotency_key: "reval-setup-001",
    });
    const { submissions, entries } = await generateFxRevaluations(
      "2026-03", { EUR: "0.88" }
    );
    const entry = entries.find((e) => e.account_code === "1100");
    expect(entry).toBeDefined();
    expect(parseFloat(entry!.foreign_net_balance)).toBeCloseTo(1000, 4);
    expect(parseFloat(entry!.recorded_base_net_balance)).toBeCloseTo(860, 4);
    expect(parseFloat(entry!.new_base_net_balance)).toBeCloseTo(880, 4);
    expect(parseFloat(entry!.adjustment)).toBeCloseTo(20, 2);
    const sub = submissions.find((s) => s.lines.some((l) => l.account_code === "1100"));
    expect(sub).toBeDefined();
    const acctLine = sub!.lines.find((l) => l.account_code === "1100");
    const fxLine   = sub!.lines.find((l) => l.account_code === "7200");
    expect(acctLine).toBeDefined();
    expect(fxLine).toBeDefined();
    expect(parseFloat(acctLine!.net_amount!)).toBeCloseTo(20, 2);
    expect(parseFloat(fxLine!.net_amount!)).toBeCloseTo(-20, 2);
  });

  it("does not revalue REVENUE accounts -- only ASSET and LIABILITY", async () => {
    await postTransaction({
      transaction_type: "MANUAL_JOURNAL",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "EUR",
      exchange_rate: "0.86",
      reference: "EUR-REVENUE-SETUP",
      description: "Setup EUR revenue",
      lines: [
        { account_code: "1000", description: "Bank EUR", net_amount: "1000.00" },
        { account_code: "4000", description: "Revenue EUR", net_amount: "-1000.00" },
      ],
      source: { module_id: "test-module" },
      idempotency_key: "reval-setup-002",
    });
    const { entries } = await generateFxRevaluations(
      "2026-03", { EUR: "0.88" }
    );
    expect(entries.find((e) => e.account_code === "4000")).toBeUndefined();
  });

  it("generates no revaluation when the exchange rate is unchanged", async () => {
    await postTransaction({
      transaction_type: "MANUAL_JOURNAL",
      date: "2026-03-10",
      period_id: "2026-03",
      currency: "EUR",
      exchange_rate: "0.86",
      reference: "EUR-SAME-RATE",
      description: "EUR same rate",
      lines: [
        { account_code: "1100", description: "Debtors", net_amount: "1000.00" },
        { account_code: "3100", description: "Equity", net_amount: "-1000.00" },
      ],
      source: { module_id: "test-module" },
      idempotency_key: "reval-setup-003",
    });
    const { submissions, entries } = await generateFxRevaluations(
      "2026-03", { EUR: "0.86" }
    );
    expect(submissions.length).toBe(0);
    expect(entries.length).toBe(0);
  });
});

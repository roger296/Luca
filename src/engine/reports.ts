import Decimal from "decimal.js";
import { knex } from "../db/connection";
import type {
  TrialBalanceReport,
  TrialBalanceLine,
  ProfitAndLossReport,
  PnLSection,
  PnLAccountLine,
  BalanceSheetReport,
  BalanceSheetSection,
  CashFlowReport,
  CashFlowAdjustment,
  AccountCategory,
  DataFlag,
} from "./types";

// ─── Trial Balance ────────────────────────────────────────────────────────────

export async function getTrialBalance(
  options: { period_id?: string; as_at_date?: string }
): Promise<TrialBalanceReport> {
  const query = knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .groupBy("tl.account_code", "a.name", "a.category", "a.type")
    .orderBy("tl.account_code", "asc")
    .select(
      "tl.account_code",
      "a.name as account_name",
      "a.category",
      "a.type",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS credit")
    );

  if (options.period_id) query.where("t.period_id", options.period_id);
  if (options.as_at_date) query.where("t.date", "<=", options.as_at_date);

  const rows = (await query) as Array<{
    account_code: string;
    account_name: string;
    category: AccountCategory;
    type: string | null;
    debit: string;
    credit: string;
  }>;

  let totalDebits = new Decimal(0);
  let totalCredits = new Decimal(0);
  const lines: TrialBalanceLine[] = [];

  for (const row of rows) {
    const debit = new Decimal(row.debit);
    const credit = new Decimal(row.credit);
    const netDebit = debit.minus(credit);
    if (netDebit.gte(0)) {
      lines.push({
        account_code: row.account_code,
        account_name: row.account_name,
        category: row.category,
        type: row.type,
        debit: netDebit.toFixed(4),
        credit: "0.0000",
      });
      totalDebits = totalDebits.plus(netDebit);
    } else {
      lines.push({
        account_code: row.account_code,
        account_name: row.account_name,
        category: row.category,
        type: row.type,
        debit: "0.0000",
        credit: netDebit.abs().toFixed(4),
      });
      totalCredits = totalCredits.plus(netDebit.abs());
    }
  }

  let dataFlag: DataFlag = "PROVISIONAL";
  if (options.period_id) {
    const period = await knex("periods")
      .where({ period_id: options.period_id })
      .first();
    if (period && (period as Record<string, unknown>)["data_flag"] === "AUTHORITATIVE") {
      dataFlag = "AUTHORITATIVE";
    }
  }

  return {
    period_id: options.period_id ?? "all",
    data_flag: dataFlag,
    as_at_date: options.as_at_date ?? null,
    lines,
    total_debits: totalDebits.toFixed(4),
    total_credits: totalCredits.toFixed(4),
    balanced: totalDebits.minus(totalCredits).abs().lte(new Decimal("0.01")),
  };
}

// ─── Profit & Loss ────────────────────────────────────────────────────────────

export async function getProfitAndLoss(
  options: { period_id?: string; date_from?: string; date_to?: string }
): Promise<ProfitAndLossReport> {
  let dateFrom = options.date_from;
  let dateTo = options.date_to;
  const periodId = options.period_id ?? "";

  if (options.period_id && (!dateFrom || !dateTo)) {
    const [year, month] = options.period_id.split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    dateFrom = dateFrom ?? start.toISOString().slice(0, 10);
    dateTo = dateTo ?? end.toISOString().slice(0, 10);
  }

  const query = knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .whereIn("a.category", ["REVENUE", "EXPENSE"])
    .groupBy("tl.account_code", "a.name", "a.category", "a.type")
    .orderBy("tl.account_code", "asc")
    .select(
      "tl.account_code",
      "a.name as account_name",
      "a.category",
      "a.type",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    );

  if (options.period_id) query.where("t.period_id", options.period_id);
  if (dateFrom) query.where("t.date", ">=", dateFrom);
  if (dateTo) query.where("t.date", "<=", dateTo);

  const rows = (await query) as Array<{
    account_code: string;
    account_name: string;
    category: string;
    type: string | null;
    total_debit: string;
    total_credit: string;
  }>;

  interface SectionAcc {
    name: string;
    category: string;
    accounts: PnLAccountLine[];
    totalAmt: Decimal;
  }

  const sectionMap: Record<string, SectionAcc> = {
    REVENUE: { name: "Revenue", category: "REVENUE", accounts: [], totalAmt: new Decimal(0) },
    DIRECT_COSTS: { name: "Cost of Sales", category: "DIRECT_COSTS", accounts: [], totalAmt: new Decimal(0) },
    OVERHEADS: { name: "Overheads", category: "OVERHEADS", accounts: [], totalAmt: new Decimal(0) },
    FINANCE_COSTS: { name: "Finance Costs", category: "FINANCE_COSTS", accounts: [], totalAmt: new Decimal(0) },
    OTHER_INCOME: { name: "Other Income", category: "OTHER_INCOME", accounts: [], totalAmt: new Decimal(0) },
  };

  for (const row of rows) {
    const credit = new Decimal(row.total_credit);
    const debit = new Decimal(row.total_debit);
    let netAmt: Decimal;
    let sectionKey: string;

    if (row.category === "REVENUE") {
      netAmt = credit.minus(debit);
      sectionKey = row.type === "OTHER_INCOME" ? "OTHER_INCOME" : "REVENUE";
    } else {
      netAmt = debit.minus(credit);
      const validExpenseSections = ["DIRECT_COSTS", "OVERHEADS", "FINANCE_COSTS"];
      sectionKey = row.type && validExpenseSections.includes(row.type) ? row.type : "OVERHEADS";
    }

    const section = sectionMap[sectionKey];
    if (section) {
      section.accounts.push({
        account_code: row.account_code,
        account_name: row.account_name,
        amount: netAmt.toFixed(4),
      });
      section.totalAmt = section.totalAmt.plus(netAmt);
    }
  }

  const sections: PnLSection[] = Object.values(sectionMap)
    .filter((s) => s.accounts.length > 0)
    .map((s) => ({
      name: s.name,
      category: s.category,
      accounts: s.accounts,
      total: s.totalAmt.toFixed(4),
    }));

  const totalRevenue = sectionMap["REVENUE"]!.totalAmt.plus(sectionMap["OTHER_INCOME"]!.totalAmt);
  const totalCostOfSales = sectionMap["DIRECT_COSTS"]!.totalAmt;
  const grossProfit = totalRevenue.minus(totalCostOfSales);
  const totalOverheads = sectionMap["OVERHEADS"]!.totalAmt.plus(sectionMap["FINANCE_COSTS"]!.totalAmt);
  const netProfit = grossProfit.minus(totalOverheads);

  let dataFlag: DataFlag = "PROVISIONAL";
  if (options.period_id) {
    const period = await knex("periods")
      .where({ period_id: options.period_id })
      .first();
    if (period && (period as Record<string, unknown>)["data_flag"] === "AUTHORITATIVE") {
      dataFlag = "AUTHORITATIVE";
    }
  }

  return {
    period_id: periodId,
    date_from: dateFrom ?? "",
    date_to: dateTo ?? "",
    data_flag: dataFlag,
    sections,
    gross_profit: grossProfit.toFixed(4),
    total_overheads: totalOverheads.toFixed(4),
    net_profit: netProfit.toFixed(4),
  };
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────

export async function getBalanceSheet(
  options: { as_at_date?: string; period_id?: string }
): Promise<BalanceSheetReport> {
  let asAtDate = options.as_at_date;
  if (!asAtDate && options.period_id) {
    const [year, month] = options.period_id.split("-").map(Number);
    const end = new Date(year, month, 0);
    asAtDate = end.toISOString().slice(0, 10);
  }
  asAtDate = asAtDate ?? new Date().toISOString().slice(0, 10);

  const query = knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .where("t.date", "<=", asAtDate)
    .whereIn("a.category", ["ASSET", "LIABILITY", "EQUITY"])
    .groupBy("tl.account_code", "a.name", "a.category", "a.type")
    .orderBy("tl.account_code", "asc")
    .select(
      "tl.account_code",
      "a.name as account_name",
      "a.category",
      "a.type",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    );

  const rows = (await query) as Array<{
    account_code: string;
    account_name: string;
    category: string;
    type: string | null;
    total_debit: string;
    total_credit: string;
  }>;

  interface SectionAcc {
    name: string;
    category: string;
    accounts: PnLAccountLine[];
    totalAmt: Decimal;
  }

  const assetSections: Record<string, SectionAcc> = {
    CURRENT_ASSET: { name: "Current Assets", category: "CURRENT_ASSET", accounts: [], totalAmt: new Decimal(0) },
    FIXED_ASSET: { name: "Fixed Assets", category: "FIXED_ASSET", accounts: [], totalAmt: new Decimal(0) },
  };

  const liabilitySections: Record<string, SectionAcc> = {
    CURRENT_LIABILITY: { name: "Current Liabilities", category: "CURRENT_LIABILITY", accounts: [], totalAmt: new Decimal(0) },
    LONG_TERM_LIABILITY: { name: "Long-term Liabilities", category: "LONG_TERM_LIABILITY", accounts: [], totalAmt: new Decimal(0) },
  };

  const equitySection: SectionAcc = {
    name: "Equity",
    category: "EQUITY",
    accounts: [],
    totalAmt: new Decimal(0),
  };

  for (const row of rows) {
    const debit = new Decimal(row.total_debit);
    const credit = new Decimal(row.total_credit);

    if (row.category === "ASSET") {
      const netAmt = debit.minus(credit);
      const sectionKey = row.type === "FIXED_ASSET" ? "FIXED_ASSET" : "CURRENT_ASSET";
      const section = assetSections[sectionKey]!;
      section.accounts.push({ account_code: row.account_code, account_name: row.account_name, amount: netAmt.toFixed(4) });
      section.totalAmt = section.totalAmt.plus(netAmt);
    } else if (row.category === "LIABILITY") {
      const netAmt = credit.minus(debit);
      const sectionKey = row.type === "LONG_TERM_LIABILITY" ? "LONG_TERM_LIABILITY" : "CURRENT_LIABILITY";
      const section = liabilitySections[sectionKey]!;
      section.accounts.push({ account_code: row.account_code, account_name: row.account_name, amount: netAmt.toFixed(4) });
      section.totalAmt = section.totalAmt.plus(netAmt);
    } else if (row.category === "EQUITY") {
      const netAmt = credit.minus(debit);
      equitySection.accounts.push({ account_code: row.account_code, account_name: row.account_name, amount: netAmt.toFixed(4) });
      equitySection.totalAmt = equitySection.totalAmt.plus(netAmt);
    }
  }

  const assetsOut: BalanceSheetSection[] = Object.values(assetSections)
    .filter((s) => s.accounts.length > 0)
    .map((s) => ({ name: s.name, category: s.category, accounts: s.accounts, total: s.totalAmt.toFixed(4) }));

  const liabilitiesOut: BalanceSheetSection[] = Object.values(liabilitySections)
    .filter((s) => s.accounts.length > 0)
    .map((s) => ({ name: s.name, category: s.category, accounts: s.accounts, total: s.totalAmt.toFixed(4) }));

  const equityOut: BalanceSheetSection[] = equitySection.accounts.length > 0
    ? [{ name: equitySection.name, category: equitySection.category, accounts: equitySection.accounts, total: equitySection.totalAmt.toFixed(4) }]
    : [];

  const totalAssets = Object.values(assetSections).reduce((acc, s) => acc.plus(s.totalAmt), new Decimal(0));
  const totalLiabilities = Object.values(liabilitySections).reduce((acc, s) => acc.plus(s.totalAmt), new Decimal(0));
  const totalLiabilitiesAndEquity = totalLiabilities.plus(equitySection.totalAmt);

  let dataFlag: DataFlag = "PROVISIONAL";
  if (options.period_id) {
    const period = await knex("periods")
      .where({ period_id: options.period_id })
      .first();
    if (period && (period as Record<string, unknown>)["data_flag"] === "AUTHORITATIVE") {
      dataFlag = "AUTHORITATIVE";
    }
  }

  return {
    as_at_date: asAtDate,
    period_id: options.period_id ?? "",
    data_flag: dataFlag,
    assets: assetsOut,
    liabilities: liabilitiesOut,
    equity: equityOut,
    total_assets: totalAssets.toFixed(4),
    total_liabilities_and_equity: totalLiabilitiesAndEquity.toFixed(4),
    balanced: totalAssets.minus(totalLiabilitiesAndEquity).abs().lte(new Decimal("0.01")),
  };
}

// ─── Cash Flow (indirect method) ─────────────────────────────────────────────

export async function getCashFlow(
  options: { period_id: string }
): Promise<CashFlowReport> {
  const periodId = options.period_id;
  const [year, month] = periodId.split("-").map(Number);
  // Use Date.UTC to avoid local-timezone offset shifting the date when converted to ISO string
  const periodStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  // ── 1. Net profit from P&L ────────────────────────────────────────────────
  const pnl = await getProfitAndLoss({ period_id: periodId });
  const netProfit = new Decimal(pnl.net_profit);

  // ── 2. Non-cash adjustments: depreciation (6600) and stock write-offs (6800)
  const nonCashAccounts = ["6600", "6800"];
  const nonCashRows = (await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .where("t.period_id", periodId)
    .whereIn("tl.account_code", nonCashAccounts)
    .groupBy("tl.account_code", "a.name")
    .select(
      "tl.account_code",
      "a.name as account_name",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    )) as Array<{ account_code: string; account_name: string; total_debit: string; total_credit: string }>;

  const adjustments: CashFlowAdjustment[] = [];
  let totalNonCashAdj = new Decimal(0);
  for (const row of nonCashRows) {
    const netDebit = new Decimal(row.total_debit).minus(row.total_credit);
    if (!netDebit.isZero()) {
      adjustments.push({ description: `Add back: ${row.account_name}`, amount: netDebit.toFixed(4) });
      totalNonCashAdj = totalNonCashAdj.plus(netDebit);
    }
  }

  // ── 3. Working capital changes ────────────────────────────────────────────
  // For both asset and liability WC accounts: cash_effect = -(net_debit)
  // Assets: net_debit > 0 = increase in asset = cash outflow
  // Liabilities: net_debit < 0 (i.e. net_credit > 0) = increase in liability = cash inflow
  const workingCapitalAccounts = [
    { code: "1100", name: "Change in trade debtors" },
    { code: "1300", name: "Change in stock" },
    { code: "1400", name: "Change in prepayments" },
    { code: "2000", name: "Change in trade creditors" },
    { code: "2150", name: "Change in accruals" },
  ];
  const wcCodes = workingCapitalAccounts.map((a) => a.code);

  const wcRows = (await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .where("t.status", "POSTED")
    .where("t.period_id", periodId)
    .whereIn("tl.account_code", wcCodes)
    .groupBy("tl.account_code")
    .select(
      "tl.account_code",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    )) as Array<{ account_code: string; total_debit: string; total_credit: string }>;

  const wcMap = new Map(wcRows.map((r) => [r.account_code, r]));
  const workingCapitalChanges: CashFlowAdjustment[] = [];
  let totalWcChanges = new Decimal(0);

  for (const acct of workingCapitalAccounts) {
    const data = wcMap.get(acct.code);
    if (!data) continue;
    const netDebit = new Decimal(data.total_debit).minus(data.total_credit);
    if (netDebit.isZero()) continue;
    const cashEffect = netDebit.negated();
    workingCapitalChanges.push({ description: acct.name, amount: cashEffect.toFixed(4) });
    totalWcChanges = totalWcChanges.plus(cashEffect);
  }

  const netCashFromOperations = netProfit.plus(totalNonCashAdj).plus(totalWcChanges);

  // ── 4. Investing activities: fixed asset accounts 1500, 1510 ──────────────
  const investingAccounts = ["1500", "1510"];
  const investRows = (await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .where("t.period_id", periodId)
    .whereIn("tl.account_code", investingAccounts)
    .groupBy("tl.account_code", "a.name")
    .select(
      "tl.account_code",
      "a.name as account_name",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    )) as Array<{ account_code: string; account_name: string; total_debit: string; total_credit: string }>;

  const investingItems: CashFlowAdjustment[] = [];
  let netCashFromInvesting = new Decimal(0);
  for (const row of investRows) {
    const netDebit = new Decimal(row.total_debit).minus(row.total_credit);
    if (netDebit.isZero()) continue;
    const cashEffect = netDebit.negated(); // net debit = capex outflow
    investingItems.push({ description: row.account_name, amount: cashEffect.toFixed(4) });
    netCashFromInvesting = netCashFromInvesting.plus(cashEffect);
  }

  // ── 5. Financing activities: equity issuance account 3000 ─────────────────
  const financingAccounts = ["3000"];
  const finRows = (await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .join("accounts as a", "a.code", "tl.account_code")
    .where("t.status", "POSTED")
    .where("t.period_id", periodId)
    .whereIn("tl.account_code", financingAccounts)
    .groupBy("tl.account_code", "a.name")
    .select(
      "tl.account_code",
      "a.name as account_name",
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    )) as Array<{ account_code: string; account_name: string; total_debit: string; total_credit: string }>;

  const financingItems: CashFlowAdjustment[] = [];
  let netCashFromFinancing = new Decimal(0);
  for (const row of finRows) {
    const netCredit = new Decimal(row.total_credit).minus(row.total_debit);
    if (netCredit.isZero()) continue;
    financingItems.push({ description: row.account_name, amount: netCredit.toFixed(4) });
    netCashFromFinancing = netCashFromFinancing.plus(netCredit);
  }

  // ── 6. Opening and closing cash (bank accounts 1000, 1050) ────────────────
  const bankAccounts = ["1000", "1050"];

  const openingRow = (await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .where("t.status", "POSTED")
    .where("t.date", "<", periodStart)
    .whereIn("tl.account_code", bankAccounts)
    .select(
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    )
    .first()) as unknown as { total_debit: string; total_credit: string } | undefined;

  const openingCash = openingRow
    ? new Decimal(openingRow.total_debit).minus(openingRow.total_credit)
    : new Decimal(0);

  const closingRow = (await knex("transaction_lines as tl")
    .join("transactions as t", "t.transaction_id", "tl.transaction_id")
    .where("t.status", "POSTED")
    .where("t.date", "<=", periodEnd)
    .whereIn("tl.account_code", bankAccounts)
    .select(
      knex.raw("COALESCE(SUM(tl.base_debit), 0)::text AS total_debit"),
      knex.raw("COALESCE(SUM(tl.base_credit), 0)::text AS total_credit")
    )
    .first()) as unknown as { total_debit: string; total_credit: string } | undefined;

  const closingCash = closingRow
    ? new Decimal(closingRow.total_debit).minus(closingRow.total_credit)
    : new Decimal(0);

  const netChangeInCash = closingCash.minus(openingCash);

  // ── 7. Data flag ──────────────────────────────────────────────────────────
  let dataFlag: DataFlag = "PROVISIONAL";
  const period = await knex("periods").where({ period_id: periodId }).first();
  if (period && (period as Record<string, unknown>)["data_flag"] === "AUTHORITATIVE") {
    dataFlag = "AUTHORITATIVE";
  }

  return {
    period_id: periodId,
    date_from: periodStart,
    date_to: periodEnd,
    data_flag: dataFlag,
    operating_activities: {
      net_profit: netProfit.toFixed(4),
      adjustments,
      working_capital_changes: workingCapitalChanges,
      net_cash_from_operations: netCashFromOperations.toFixed(4),
    },
    investing_activities: {
      items: investingItems,
      net_cash_from_investing: netCashFromInvesting.toFixed(4),
    },
    financing_activities: {
      items: financingItems,
      net_cash_from_financing: netCashFromFinancing.toFixed(4),
    },
    net_change_in_cash: netChangeInCash.toFixed(4),
    opening_cash: openingCash.toFixed(4),
    closing_cash: closingCash.toFixed(4),
  };
}

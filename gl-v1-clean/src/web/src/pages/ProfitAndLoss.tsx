import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProfitAndLoss } from "../hooks/useReports";
import { fmtMoney } from "../lib/api";
import { DataFlagBadge } from "../components/DataFlagBadge";
import { PeriodSelector } from "../components/PeriodSelector";
import type { PnLSection, PnLAccountLine, ProfitAndLossReport } from "../types/api";

function amtNum(s: string | undefined | null): number {
  if (!s) return 0;
  return parseFloat(s);
}

function AmountCell({ amount }: { amount: string }) {
  const n = amtNum(amount);
  if (n === 0) return <td className="num" />;
  return <td className={n < 0 ? "num neg" : "num"}>{fmtMoney(amount)}</td>;
}

function VarianceCell({ current, comparative }: { current: string; comparative: string }) {
  const c = amtNum(current);
  const p = amtNum(comparative);
  const diff = c - p;
  const pct = p !== 0 ? ((diff / Math.abs(p)) * 100) : 0;
  const cls = diff > 0 ? "num pos" : diff < 0 ? "num neg" : "num";
  return (
    <>
      <td className={cls}>{diff !== 0 ? fmtMoney(String(diff)) : ""}</td>
      <td className={cls}>{p !== 0 && diff !== 0 ? (pct.toFixed(1) + "%") : ""}</td>
    </>
  );
}

interface SectionProps {
  section: PnLSection;
  compSection?: PnLSection;
  hasComp: boolean;
  onAccountClick: (code: string) => void;
}

function PnLSectionRows({ section, compSection, hasComp, onAccountClick }: SectionProps) {
  const compMap = new Map<string, string>();
  if (compSection) {
    for (const a of compSection.accounts) {
      compMap.set(a.account_code, a.amount);
    }
  }

  return (
    <>
      <tr className="section-header">
        <td colSpan={hasComp ? 5 : 2}>{section.name}</td>
      </tr>
      {section.accounts.map(function(acc: PnLAccountLine) {
        const compAmt = compMap.get(acc.account_code) || "0";
        return (
          <tr
            key={acc.account_code}
            className="account-row"
            onClick={function() { onAccountClick(acc.account_code); }}
            style={{ cursor: "pointer" }}
          >
            <td>
              <span className="mono" style={{ fontSize: 12, marginRight: 8 }}>{acc.account_code}</span>
              {acc.account_name}
            </td>
            <AmountCell amount={acc.amount} />
            {hasComp && <AmountCell amount={compAmt} />}
            {hasComp && <VarianceCell current={acc.amount} comparative={compAmt} />}
          </tr>
        );
      })}
      <tr className="subtotal-row">
        <td>{"Total " + section.name}</td>
        <td className="num font-semibold">{fmtMoney(section.total)}</td>
        {hasComp && compSection && <td className="num font-semibold">{fmtMoney(compSection.total)}</td>}
        {hasComp && compSection && (
          <VarianceCell current={section.total} comparative={compSection.total} />
        )}
        {hasComp && !compSection && <><td className="num" /><td className="num" /><td className="num" /></>}
      </tr>
    </>
  );
}

function getSectionsByCategory(report: ProfitAndLossReport, categories: string[]): PnLSection[] {
  return report.sections.filter(function(s) { return categories.indexOf(s.category) !== -1; });
}

export function ProfitAndLoss() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("");
  const [compPeriod, setCompPeriod] = useState("");
  const [costCentre, setCostCentre] = useState("");

  const opts: Record<string, string> = {};
  if (costCentre) opts.cost_centre = costCentre;

  const { data: report, isLoading, error } = useProfitAndLoss(period, opts);

  const compOpts: Record<string, string> = {};
  if (costCentre) compOpts.cost_centre = costCentre;
  const { data: compReport } = useProfitAndLoss(compPeriod, compOpts);

  const hasComp = !!compPeriod && !!compReport;

  function handleAccountClick(code: string) {
    navigate("/accounts/" + code);
  }

  const revenueSections = report
    ? getSectionsByCategory(report, ["REVENUE", "OTHER_INCOME"])
    : [];
  const costSections = report
    ? getSectionsByCategory(report, ["DIRECT_COSTS"])
    : [];
  const overheadSections = report
    ? getSectionsByCategory(report, ["OVERHEADS", "FINANCE_COSTS"])
    : [];

  function getCompSection(section: PnLSection): PnLSection | undefined {
    if (!compReport) return undefined;
    return compReport.sections.find(function(s) {
      return s.category === section.category && s.name === section.name;
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>
            Profit &amp; Loss
          </h1>
          {report && <DataFlagBadge flag={report.data_flag} />}
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={function() { alert("Export not yet implemented"); }}
          >
            Export PDF
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={function() { alert("Export not yet implemented"); }}
          >
            Export XLSX
          </button>
        </div>
      </div>

      <div className="page-toolbar">
        <label className="form-label" style={{ marginRight: 4 }}>Period:</label>
        <PeriodSelector value={period} onChange={setPeriod} />
        <label className="form-label" style={{ marginLeft: 12, marginRight: 4 }}>Comparative:</label>
        <PeriodSelector value={compPeriod} onChange={setCompPeriod} />
        <label className="form-label" style={{ marginLeft: 12, marginRight: 4 }}>Cost Centre:</label>
        <input
          className="form-input"
          type="text"
          placeholder="All cost centres"
          value={costCentre}
          onChange={function(e) { setCostCentre(e.target.value); }}
          style={{ width: 150 }}
        />
      </div>

      <div className="page-body">
        {!period && (
          <div className="empty">Select a period to view the Profit and Loss report.</div>
        )}
        {period && isLoading && (
          <div className="loading">Loading Profit and Loss report...</div>
        )}
        {period && !isLoading && error && (
          <div className="error-box">{"Error: " + (error as Error).message}</div>
        )}
        {period && !isLoading && !error && report && (
          <>
            <div style={{ marginBottom: 8, fontSize: 13, color: "var(--text)" }}>
              {report.date_from && report.date_to
                ? ("Period: " + report.date_from + " to " + report.date_to)
                : ("Period: " + report.period_id)}
              {hasComp && compReport && (
                <span className="muted" style={{ marginLeft: 16 }}>
                  {"Comparative: " + compReport.period_id}
                </span>
              )}
            </div>
            <table className="report-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Account</th>
                  <th className="num">{period}</th>
                  {hasComp && compReport && (
                    <th className="num">{compReport.period_id}</th>
                  )}
                  {hasComp && <th className="num">Variance</th>}
                  {hasComp && <th className="num">%</th>}
                </tr>
              </thead>
              <tbody>
                {revenueSections.map(function(section) {
                  return (
                    <PnLSectionRows
                      key={section.category + "-" + section.name}
                      section={section}
                      compSection={getCompSection(section)}
                      hasComp={hasComp}
                      onAccountClick={handleAccountClick}
                    />
                  );
                })}
                {costSections.map(function(section) {
                  return (
                    <PnLSectionRows
                      key={section.category + "-" + section.name}
                      section={section}
                      compSection={getCompSection(section)}
                      hasComp={hasComp}
                      onAccountClick={handleAccountClick}
                    />
                  );
                })}
                <tr className="highlight-row">
                  <td className="font-bold">GROSS PROFIT</td>
                  <td className="num font-bold">{fmtMoney(report.gross_profit)}</td>
                  {hasComp && compReport && (
                    <td className="num font-bold">{fmtMoney(compReport.gross_profit)}</td>
                  )}
                  {hasComp && compReport && (
                    <VarianceCell
                      current={report.gross_profit}
                      comparative={compReport.gross_profit}
                    />
                  )}
                  {hasComp && !compReport && <><td className="num" /><td className="num" /></>}
                </tr>
                {overheadSections.map(function(section) {
                  return (
                    <PnLSectionRows
                      key={section.category + "-" + section.name}
                      section={section}
                      compSection={getCompSection(section)}
                      hasComp={hasComp}
                      onAccountClick={handleAccountClick}
                    />
                  );
                })}
                <tr className="highlight-row" style={{ fontSize: 15 }}>
                  <td className="font-bold">NET PROFIT</td>
                  <td className="num font-bold">{fmtMoney(report.net_profit)}</td>
                  {hasComp && compReport && (
                    <td className="num font-bold">{fmtMoney(compReport.net_profit)}</td>
                  )}
                  {hasComp && compReport && (
                    <VarianceCell
                      current={report.net_profit}
                      comparative={compReport.net_profit}
                    />
                  )}
                  {hasComp && !compReport && <><td className="num" /><td className="num" /></>}
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

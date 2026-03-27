import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBalanceSheet } from "../hooks/useReports";
import { fmtMoney } from "../lib/api";
import { DataFlagBadge } from "../components/DataFlagBadge";
import { PeriodSelector } from "../components/PeriodSelector";
import type { BalanceSheetReport, PnLAccountLine } from "../types/api";

function amtNum(s: string | undefined | null): number {
  if (!s) return 0;
  return parseFloat(s);
}

interface SectionBlockProps {
  report: BalanceSheetReport;
  categories: string[];
  sectionTitle: string;
  onAccountClick: (code: string) => void;
}

function SectionBlock({ report, categories, sectionTitle, onAccountClick }: SectionBlockProps) {
  const matchedSections = report.sections.filter(function(s) {
    return categories.indexOf(s.category) !== -1;
  });

  if (matchedSections.length === 0) return null;

  const blockTotal = matchedSections.reduce(function(sum, s) {
    return sum + amtNum(s.total);
  }, 0);

  return (
    <>
      <tr className="section-header">
        <td colSpan={2}>{sectionTitle}</td>
      </tr>
      {matchedSections.map(function(section) {
        return (
          <>
            {matchedSections.length > 1 && (
              <tr key={section.category + "-header"} style={{ background: "var(--hover)" }}>
                <td colSpan={2} style={{ paddingLeft: 16, fontSize: 12, fontStyle: "italic", color: "var(--text)" }}>
                  {section.name}
                </td>
              </tr>
            )}
            {section.accounts.map(function(acc: PnLAccountLine) {
              return (
                <tr
                  key={acc.account_code}
                  className="account-row"
                  onClick={function() { onAccountClick(acc.account_code); }}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ paddingLeft: 24 }}>
                    <span className="mono" style={{ fontSize: 12, marginRight: 8 }}>{acc.account_code}</span>
                    {acc.account_name}
                  </td>
                  <td className="num">{fmtMoney(acc.amount)}</td>
                </tr>
              );
            })}
            <tr key={section.category + "-sub"} className="subtotal-row">
              <td>{"Total " + section.name}</td>
              <td className="num font-semibold">{fmtMoney(section.total)}</td>
            </tr>
          </>
        );
      })}
      {matchedSections.length > 1 && (
        <tr className="total-row">
          <td className="font-bold">{"Total " + sectionTitle}</td>
          <td className="num font-bold">{fmtMoney(String(blockTotal))}</td>
        </tr>
      )}
    </>
  );
}

export function BalanceSheet() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("");
  const [asAtDate, setAsAtDate] = useState("");

  const opts: Record<string, string> = {};
  if (asAtDate) opts.as_at_date = asAtDate;

  const effectivePeriod = period || (asAtDate ? "current" : "");
  const { data: report, isLoading, error } = useBalanceSheet(effectivePeriod, opts);

  function handleAccountClick(code: string) {
    navigate("/accounts/" + code);
  }

  const totalAssets = report ? amtNum(report.total_assets) : 0;
  const totalLiabilities = report ? amtNum(report.total_liabilities) : 0;
  const totalEquity = report ? amtNum(report.total_equity) : 0;
  const liabPlusEquity = totalLiabilities + totalEquity;
  const balanced = report
    ? Math.abs(totalAssets - liabPlusEquity) < 0.01
    : true;

  const hasQuery = !!period || !!asAtDate;

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>
            Balance Sheet
          </h1>
          {report && <DataFlagBadge flag={report.data_flag} />}
          {report && balanced && (
            <span className="badge badge-green" style={{ fontSize: 12 }}>Balanced</span>
          )}
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
        <label className="form-label" style={{ marginLeft: 12, marginRight: 4 }}>As at date:</label>
        <input
          className="form-input"
          type="date"
          value={asAtDate}
          onChange={function(e) { setAsAtDate(e.target.value); }}
          title="As at date (overrides period)"
          style={{ width: 150 }}
        />
      </div>

      <div className="page-body">
        {!hasQuery && (
          <div className="empty">Select a period or date to view the Balance Sheet.</div>
        )}
        {hasQuery && isLoading && (
          <div className="loading">Loading Balance Sheet...</div>
        )}
        {hasQuery && !isLoading && error && (
          <div className="error-box">{"Error: " + (error as Error).message}</div>
        )}
        {hasQuery && !isLoading && !error && report && (
          <>
            {!balanced && (
              <div className="error-box" style={{ marginBottom: 12 }}>
                Balance sheet does not balance! Total Assets: {fmtMoney(report.total_assets)},
                Total Liabilities + Equity: {fmtMoney(String(liabPlusEquity))}
              </div>
            )}

            <div style={{ marginBottom: 8, fontSize: 13, color: "var(--text)" }}>
              {asAtDate ? ("As at: " + asAtDate) : ("Period: " + report.as_at_date)}
            </div>

            <table className="report-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Account</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                <SectionBlock
                  report={report}
                  categories={["CURRENT_ASSET", "FIXED_ASSET", "ASSET"]}
                  sectionTitle="ASSETS"
                  onAccountClick={handleAccountClick}
                />
                <tr className="total-row">
                  <td className="font-bold">TOTAL ASSETS</td>
                  <td className="num font-bold">{fmtMoney(report.total_assets)}</td>
                </tr>

                <tr><td colSpan={2} style={{ padding: 4 }} /></tr>

                <SectionBlock
                  report={report}
                  categories={["CURRENT_LIABILITY", "LONG_TERM_LIABILITY", "LIABILITY"]}
                  sectionTitle="LIABILITIES"
                  onAccountClick={handleAccountClick}
                />
                <tr className="total-row">
                  <td className="font-bold">TOTAL LIABILITIES</td>
                  <td className="num font-bold">{fmtMoney(report.total_liabilities)}</td>
                </tr>

                <tr><td colSpan={2} style={{ padding: 4 }} /></tr>

                <SectionBlock
                  report={report}
                  categories={["EQUITY"]}
                  sectionTitle="EQUITY"
                  onAccountClick={handleAccountClick}
                />
                <tr className="total-row">
                  <td className="font-bold">TOTAL EQUITY</td>
                  <td className="num font-bold">{fmtMoney(report.total_equity)}</td>
                </tr>

                <tr><td colSpan={2} style={{ padding: 4 }} /></tr>

                <tr className="highlight-row" style={{ fontSize: 15 }}>
                  <td className="font-bold">TOTAL LIABILITIES + EQUITY</td>
                  <td className="num font-bold">{fmtMoney(String(liabPlusEquity))}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

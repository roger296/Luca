import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTrialBalance } from "../hooks/useReports";
import { fmtMoney } from "../lib/api";
import { DataFlagBadge } from "../components/DataFlagBadge";
import { PeriodSelector } from "../components/PeriodSelector";
import type { TrialBalanceLine } from "../types/api";

function numVal(s: string | undefined | null): number {
  if (!s) return 0;
  return parseFloat(s) || 0;
}

function varNum(curr: string, comp: string): number {
  return numVal(curr) - numVal(comp);
}

export function TrialBalance() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("2026-03");
  const [compPeriod, setCompPeriod] = useState("");
  const [showComparatives, setShowComparatives] = useState(false);

  const { data: report, isLoading, error } = useTrialBalance(period);
  const { data: compReport } = useTrialBalance(compPeriod && showComparatives ? compPeriod : "");

  const hasComp = showComparatives && !!compPeriod && !!compReport;

  const totalDebit = report ? numVal(report.total_debit) : 0;
  const totalCredit = report ? numVal(report.total_credit) : 0;
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.005;

  function getCompLine(code: string): TrialBalanceLine | undefined {
    if (!compReport) return undefined;
    return compReport.lines.find(function(l) { return l.account_code === code; });
  }


  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>
            Trial Balance
          </h1>
          {report && <DataFlagBadge flag={report.data_flag} />}
          {report && !isBalanced && (
            <span className="badge badge-red" style={{ fontSize: 11 }}>DOES NOT BALANCE</span>
          )}
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={function() { alert("Export not yet implemented."); }}
          >
            Export PDF
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={function() { alert("Export not yet implemented."); }}
          >
            Export XLSX
          </button>
        </div>
      </div>

      <div className="page-toolbar">
        <label className="form-label" style={{ marginRight: 4 }}>Period:</label>
        <PeriodSelector value={period} onChange={setPeriod} />

        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 16, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showComparatives}
            onChange={function(e) { setShowComparatives(e.target.checked); }}
          />
          <span className="form-label" style={{ marginBottom: 0 }}>Include Comparatives</span>
        </label>

        {showComparatives && (
          <>
            <label className="form-label" style={{ marginLeft: 12, marginRight: 4 }}>
              Comparative Period:
            </label>
            <PeriodSelector value={compPeriod} onChange={setCompPeriod} />
          </>
        )}
      </div>

      <div className="page-body">
        {!period && <div className="empty">Select a period to view the Trial Balance.</div>}
        {period && isLoading && <div className="loading">Loading Trial Balance...</div>}
        {period && !isLoading && error && (
          <div className="error-box">{"Error: " + (error as Error).message}</div>
        )}
        {period && !isLoading && !error && report && (
          <table className="report-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 90 }}>Code</th>
                <th style={{ textAlign: "left" }}>Account Name</th>
                <th style={{ textAlign: "left", width: 120 }}>Category</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                {hasComp && compReport && (
                  <>
                    <th className="num">{"Comp. Debit (" + compPeriod + ")"}</th>
                    <th className="num">{"Comp. Credit (" + compPeriod + ")"}</th>
                    <th className="num">Variance (Dr)</th>
                    <th className="num">Variance (Cr)</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {report.lines.map(function(line: TrialBalanceLine) {
                const comp = hasComp ? getCompLine(line.account_code) : undefined;
                const varDr = comp ? varNum(line.debit, comp.debit) : 0;
                const varCr = comp ? varNum(line.credit, comp.credit) : 0;

                return (
                  <tr key={line.account_code}>
                    <td className="mono text-sm">{line.account_code}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: "0 2px", fontWeight: "normal", textAlign: "left" }}
                        onClick={function() { navigate("/accounts/" + line.account_code); }}
                      >
                        {line.account_name}
                      </button>
                    </td>
                    <td className="text-sm muted">{line.category}</td>
                    <td className="num text-sm">{numVal(line.debit) !== 0 ? fmtMoney(line.debit) : ""}</td>
                    <td className="num text-sm">{numVal(line.credit) !== 0 ? fmtMoney(line.credit) : ""}</td>
                    {hasComp && (
                      <>
                        <td className="num text-sm">
                          {comp && numVal(comp.debit) !== 0 ? fmtMoney(comp.debit) : ""}
                        </td>
                        <td className="num text-sm">
                          {comp && numVal(comp.credit) !== 0 ? fmtMoney(comp.credit) : ""}
                        </td>
                        <td
                          className="num text-sm"
                          style={{ color: varDr > 0 ? "#16a34a" : varDr < 0 ? "#dc2626" : undefined }}
                        >
                          {comp && varDr !== 0 ? fmtMoney(String(varDr)) : ""}
                        </td>
                        <td
                          className="num text-sm"
                          style={{ color: varCr > 0 ? "#16a34a" : varCr < 0 ? "#dc2626" : undefined }}
                        >
                          {comp && varCr !== 0 ? fmtMoney(String(varCr)) : ""}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr
                style={{
                  fontWeight: 700,
                  borderTop: "2px solid var(--border, #e5e7eb)",
                  background: isBalanced ? undefined : "#fef2f2",
                }}
              >
                <td colSpan={hasComp ? 3 : 3} className="font-bold">
                  Totals
                  {!isBalanced && (
                    <span className="badge badge-red" style={{ marginLeft: 8, fontSize: 10 }}>
                      IMBALANCE
                    </span>
                  )}
                </td>
                <td className="num font-bold">{fmtMoney(report.total_debit)}</td>
                <td className="num font-bold">{fmtMoney(report.total_credit)}</td>
                {hasComp && compReport && (
                  <>
                    <td className="num font-bold">{fmtMoney(compReport.total_debit)}</td>
                    <td className="num font-bold">{fmtMoney(compReport.total_credit)}</td>
                    <td className="num" />
                    <td className="num" />
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useCashFlow } from "../hooks/useReports";
import { fmtMoney } from "../lib/api";
import { DataFlagBadge } from "../components/DataFlagBadge";
import { PeriodSelector } from "../components/PeriodSelector";

function amtNum(s: string | undefined | null): number {
  if (!s) return 0;
  return parseFloat(s);
}

function AmountCell({ amount }: { amount: string }) {
  const n = amtNum(amount);
  if (n === 0) return <td className="num muted">{fmtMoney(amount)}</td>;
  return <td className={n < 0 ? "num neg" : "num"}>{fmtMoney(amount)}</td>;
}

interface LineItem {
  label: string;
  amount: string;
}

function ItemRows({ items }: { items: LineItem[] }) {
  if (!items || items.length === 0) {
    return (
      <tr className="account-row">
        <td style={{ paddingLeft: 24 }} className="muted">No items</td>
        <td className="num" />
      </tr>
    );
  }
  return (
    <>
      {items.map(function(item, i) {
        return (
          <tr key={String(i)} className="account-row">
            <td style={{ paddingLeft: 24 }}>{item.label}</td>
            <AmountCell amount={item.amount} />
          </tr>
        );
      })}
    </>
  );
}

export function CashFlow() {
  const [period, setPeriod] = useState("");

  const { data: report, isLoading, error } = useCashFlow(period);

  const closingCashNum = report ? amtNum(report.closing_cash) : 0;
  const openingCashNum = report ? amtNum(report.opening_cash) : 0;
  const netChangeNum = report ? amtNum(report.net_change_in_cash) : 0;
  const derivedClosing = openingCashNum + netChangeNum;
  const reconciled = report
    ? Math.abs(closingCashNum - derivedClosing) < 0.01
    : false;

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>
            Cash Flow
          </h1>
          {report && <DataFlagBadge flag={report.data_flag} />}
          {report && reconciled && (
            <span className="badge badge-green" style={{ fontSize: 12 }}>Reconciled to bank</span>
          )}
          {report && !reconciled && (
            <span className="badge badge-amber" style={{ fontSize: 12 }}>Unreconciled</span>
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
      </div>

      <div className="page-body">
        {!period && (
          <div className="empty">Select a period to view the Cash Flow statement.</div>
        )}
        {period && isLoading && (
          <div className="loading">Loading Cash Flow statement...</div>
        )}
        {period && !isLoading && error && (
          <div className="error-box">{"Error: " + (error as Error).message}</div>
        )}
        {period && !isLoading && !error && report && (
          <>
            <div style={{ marginBottom: 8, fontSize: 13, color: "var(--text)" }}>
              {"Period: " + report.period_id + " (indirect method)"}
            </div>

            <table className="report-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Description</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>

                {/* --- OPERATING ACTIVITIES --- */}
                <tr className="section-header">
                  <td colSpan={2}>OPERATING ACTIVITIES</td>
                </tr>
                <tr className="account-row" style={{ fontStyle: "italic" }}>
                  <td style={{ paddingLeft: 24 }}>Net Profit</td>
                  <td className="num font-semibold">
                    {fmtMoney(report.operating_activities.net_profit)}
                  </td>
                </tr>

                {report.operating_activities.adjustments.length > 0 && (
                  <>
                    <tr style={{ background: "var(--hover)" }}>
                      <td
                        colSpan={2}
                        style={{
                          paddingLeft: 16,
                          fontSize: 12,
                          fontStyle: "italic",
                          color: "var(--text)",
                        }}
                      >
                        Adjustments for non-cash items
                      </td>
                    </tr>
                    <ItemRows items={report.operating_activities.adjustments} />
                  </>
                )}

                {report.operating_activities.working_capital_changes.length > 0 && (
                  <>
                    <tr style={{ background: "var(--hover)" }}>
                      <td
                        colSpan={2}
                        style={{
                          paddingLeft: 16,
                          fontSize: 12,
                          fontStyle: "italic",
                          color: "var(--text)",
                        }}
                      >
                        Changes in working capital
                      </td>
                    </tr>
                    <ItemRows items={report.operating_activities.working_capital_changes} />
                  </>
                )}

                <tr className="subtotal-row">
                  <td className="font-semibold">NET CASH FROM OPERATING ACTIVITIES</td>
                  <AmountCell amount={report.operating_activities.net_cash_from_operations} />
                </tr>

                <tr><td colSpan={2} style={{ padding: 4 }} /></tr>

                {/* --- INVESTING ACTIVITIES --- */}
                <tr className="section-header">
                  <td colSpan={2}>INVESTING ACTIVITIES</td>
                </tr>
                <ItemRows items={report.investing_activities.items} />
                <tr className="subtotal-row">
                  <td className="font-semibold">NET CASH FROM INVESTING ACTIVITIES</td>
                  <AmountCell amount={report.investing_activities.net_cash_from_investing} />
                </tr>

                <tr><td colSpan={2} style={{ padding: 4 }} /></tr>

                {/* --- FINANCING ACTIVITIES --- */}
                <tr className="section-header">
                  <td colSpan={2}>FINANCING ACTIVITIES</td>
                </tr>
                <ItemRows items={report.financing_activities.items} />
                <tr className="subtotal-row">
                  <td className="font-semibold">NET CASH FROM FINANCING ACTIVITIES</td>
                  <AmountCell amount={report.financing_activities.net_cash_from_financing} />
                </tr>

                <tr><td colSpan={2} style={{ padding: 4 }} /></tr>

                {/* --- SUMMARY --- */}
                <tr className="highlight-row">
                  <td className="font-bold">NET CHANGE IN CASH</td>
                  <td
                    className={
                      "num font-bold " +
                      (netChangeNum < 0 ? "neg" : netChangeNum > 0 ? "pos" : "")
                    }
                  >
                    {fmtMoney(report.net_change_in_cash)}
                  </td>
                </tr>

                <tr className="account-row">
                  <td style={{ paddingLeft: 24 }}>Opening cash balance</td>
                  <td className="num">{fmtMoney(report.opening_cash)}</td>
                </tr>

                <tr className="highlight-row" style={{ fontSize: 15 }}>
                  <td className="font-bold">CLOSING CASH BALANCE</td>
                  <td className="num font-bold">{fmtMoney(report.closing_cash)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}


import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccountLedger, useAccountBalance } from "../hooks/useAccounts";
import { fmtMoney, fmtDate } from "../lib/api";

export function AccountLedger() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [period, setPeriod] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string | number>>({
    page: 1, page_size: 25,
  });

  const { data: ledgerData, isLoading, error } = useAccountLedger(code ?? "", appliedFilters);
  const { data: balanceData } = useAccountBalance(code ?? "", {});

  const entries: Record<string, unknown>[] = (ledgerData?.entries as Record<string, unknown>[]) ?? [];
  const totalEntries: number = ledgerData?.total ?? 0;
  const totalPages = Math.ceil(totalEntries / ((appliedFilters.page_size as number) || 25));

  const runningBalances = useMemo(() => {
    let running = 0;
    return entries.map((entry) => {
      const debit = parseFloat(String(entry.debit ?? "0")) || 0;
      const credit = parseFloat(String(entry.credit ?? "0")) || 0;
      running += debit - credit;
      return running;
    });
  }, [entries]);

  function handleApply() {
    const params: Record<string, string | number> = { page, page_size: pageSize };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (period) params.period = period;
    setAppliedFilters(params);
  }

  const pageTitle = code ? code : "Account Ledger";
  const drBal = fmtMoney(balanceData?.debit);
  const crBal = fmtMoney(balanceData?.credit);
  const netBal = fmtMoney(balanceData?.net);

  return (
    <div className="page">
      <div className="page-header">
        <div className="flex gap-3 flex-center">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate("/accounts")}>&lt; Accounts</button>
          <h1>{pageTitle}</h1>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => alert("Export CSV: not yet implemented")}>Export CSV</button>
        </div>
      </div>

      <div className="page-toolbar">
        <label className="form-label">From</label>
        <input type="date" className="form-input" style={{ width: 140 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <label className="form-label">To</label>
        <input type="date" className="form-input" style={{ width: 140 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <label className="form-label">Period</label>
        <input type="text" className="form-input" style={{ width: 100 }} placeholder="2026-03" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <label className="form-label">Rows</label>
        <select className="form-select" style={{ width: 80 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={handleApply}>Apply</button>
      </div>

      <div className="page-body">
        <div className="flex gap-3 mb-4">
          {[["Total Debits", drBal], ["Total Credits", crBal], ["Net Balance", netBal]].map(([label, val]) => (
            <div key={label} className="card" style={{ minWidth: 150 }}>
              <div className="text-sm muted">{label}</div>
              <div className="mono font-semibold">{val || "—"}</div>
            </div>
          ))}
        </div>

        {isLoading && <div className="loading">Loading ledger...</div>}
        {error && <div className="error-box">{"Failed: " + (error as Error).message}</div>}
        {!isLoading && !error && entries.length === 0 && (
          <div className="empty">No transactions for this account in the selected period.</div>
        )}

        {!isLoading && !error && entries.length > 0 && (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th><th>Reference</th><th>Description</th><th>Type</th>
                  <th className="num">Debit</th><th className="num">Credit</th><th className="num">Running Bal.</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const rb = runningBalances[idx];
                  const rbCls = "mono " + (rb < 0 ? "neg" : rb > 0 ? "pos" : "");
                  const debit = String(entry.debit ?? "0");
                  const credit = String(entry.credit ?? "0");
                  const dAmt = parseFloat(debit);
                  const cAmt = parseFloat(credit);
                  return (
                    <tr key={String(entry.transaction_id ?? "") + "-" + idx}>
                      <td className="mono text-sm">{fmtDate(String(entry.date ?? ""))}</td>
                      <td className="text-sm">{String(entry.reference ?? "")}</td>
                      <td className="text-sm">{String(entry.description ?? "")}</td>
                      <td><span className="badge badge-blue text-xs">{String(entry.transaction_type ?? "")}</span></td>
                      <td className="num">{dAmt > 0 ? <span className="mono">{fmtMoney(debit)}</span> : <span className="muted">—</span>}</td>
                      <td className="num">{cAmt > 0 ? <span className="mono">{fmtMoney(credit)}</span> : <span className="muted">—</span>}</td>
                      <td className={"num " + rbCls}>{fmtMoney(String(Math.abs(rb)))}{rb < 0 ? " CR" : rb > 0 ? " DR" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-center gap-3 mt-3" style={{ justifyContent: "space-between" }}>
              <span className="text-sm muted">{"Page " + page + " of " + totalPages + " (" + totalEntries + " entries)"}</span>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

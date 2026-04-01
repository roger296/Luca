import { useState, useCallback, useMemo } from "react";
import { useTransactions } from "../hooks/useTransactions";
import { fmtMoney, fmtDate, shortHash } from "../lib/api";
import { PeriodSelector } from "../components/PeriodSelector";
import { SupportingDocModal } from "../components/SupportingDocModal";
import { useTransactionDocuments } from "../hooks/useTransactionDocuments";
import type { Transaction } from "../types/api";

const TX_TYPES = [
  "CUSTOMER_INVOICE",
  "CUSTOMER_CREDIT_NOTE",
  "CUSTOMER_PAYMENT",
  "SUPPLIER_INVOICE",
  "SUPPLIER_PAYMENT",
  "MANUAL_JOURNAL",
  "STOCK_RECEIPT",
  "STOCK_DISPATCH",
  "BANK_RECEIPT",
  "BANK_PAYMENT",
];

const CORR_TINTS = ["rgba(99,102,241,0.07)", "rgba(16,185,129,0.07)"];

function useCorrColors(transactions: Transaction[]): Map<string, string> {
  return useMemo(function() {
    const map = new Map<string, string>();
    let idx = 0;
    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];
      if (txn.correlation_id && !map.has(txn.correlation_id)) {
        map.set(txn.correlation_id, CORR_TINTS[idx % CORR_TINTS.length]);
        idx++;
      }
    }
    return map;
  }, [transactions]);
}

interface Filters {
  period: string;
  date_from: string;
  date_to: string;
  transaction_type: string;
  currency: string;
  reference: string;
}

const EMPTY_FILTERS: Filters = {
  period: "",
  date_from: "",
  date_to: "",
  transaction_type: "",
  currency: "",
  reference: "",
};

function SupportingDocButton({
  transactionId,
  onClick,
}: {
  transactionId: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const { data: docs, isLoading } = useTransactionDocuments(transactionId);
  if (isLoading) return <span style={{ fontSize: 11, color: "var(--text)" }}>…</span>;
  if (!docs || docs.length === 0) return <span style={{ fontSize: 11, color: "var(--text)" }}>None attached</span>;
  return (
    <button
      className="btn btn-primary btn-sm"
      style={{ fontSize: 12 }}
      onClick={onClick}
    >
      View Supporting Doc
    </button>
  );
}

export function Journal() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [docModalTxnId, setDocModalTxnId] = useState<string | null>(null);

  const { data, isLoading, error } = useTransactions({ ...applied, page, page_size: PAGE_SIZE });

  const transactions: Transaction[] = data ? data.transactions : [];
  const total = data ? data.total : 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showTo = Math.min(page * PAGE_SIZE, total);

  const corrColors = useCorrColors(transactions);

  function setField(key: keyof Filters) {
    return function(val: string) {
      setDraft(function(d) {
        const next = { ...d } as Filters;
        next[key] = val;
        return next;
      });
    };
  }

  const handleSearch = useCallback(function() {
    setPage(1);
    setApplied({ ...draft });
  }, [draft]);

  const handleClear = useCallback(function() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
    setExpandedId(null);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>Journal</h1>
        <button className="btn btn-primary" disabled title="Post transactions via API">
          New Transaction
        </button>
      </div>

      <div className="page-toolbar" onKeyDown={handleKeyDown} role="search">
        <PeriodSelector value={draft.period} onChange={setField("period")} />

        <input
          className="form-input"
          type="date"
          value={draft.date_from}
          onChange={function(e) { setField("date_from")(e.target.value); }}
          title="Date from"
          style={{ width: 140 }}
        />
        <input
          className="form-input"
          type="date"
          value={draft.date_to}
          onChange={function(e) { setField("date_to")(e.target.value); }}
          title="Date to"
          style={{ width: 140 }}
        />

        <select
          className="form-select"
          value={draft.transaction_type}
          onChange={function(e) { setField("transaction_type")(e.target.value); }}
          style={{ width: 195 }}
        >
          <option value="">-- All types --</option>
          {TX_TYPES.map(function(t) {
            return <option key={t} value={t}>{t.replace(/_/g, " ")}</option>;
          })}
        </select>

        <input
          className="form-input"
          type="text"
          placeholder="Currency"
          value={draft.currency}
          onChange={function(e) { setField("currency")(e.target.value.toUpperCase().slice(0, 3)); }}
          style={{ width: 80 }}
        />

        <input
          className="form-input"
          type="text"
          placeholder="Reference / search"
          value={draft.reference}
          onChange={function(e) { setField("reference")(e.target.value); }}
          style={{ width: 175 }}
        />

        <button className="btn btn-primary btn-sm" onClick={handleSearch}>Search</button>
        <button className="btn btn-secondary btn-sm" onClick={handleClear}>Clear</button>
      </div>

      <div className="page-body">
        {isLoading && <div className="loading">Loading transactions...</div>}
        {!isLoading && error && (
          <div className="error-box">{"Error: " + (error as Error).message}</div>
        )}

        {!isLoading && !error && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                {total === 0 ? "No transactions" : ("Showing " + String(showFrom) + "–" + String(showTo) + " of " + String(total))}
              </span>
              {total > PAGE_SIZE && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="btn btn-secondary btn-sm" disabled={page <= 1}
                    onClick={function() { setPage(function(p) { return p - 1; }); }}>
                    Prev
                  </button>
                  <span style={{ fontSize: 13 }}>{"Page " + String(page) + " / " + String(pageCount)}</span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= pageCount}
                    onClick={function() { setPage(function(p) { return p + 1; }); }}>
                    Next
                  </button>
                </div>
              )}
            </div>

            {transactions.length === 0
              ? <div className="empty">No transactions match your filters</div>
              : (
                <table className="tbl" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Date</th>
                      <th>Reference</th>
                      <th style={{ width: 160 }}>Transaction ID</th>
                      <th>Type</th>
                      <th style={{ width: 130 }}>Source</th>
                      <th style={{ width: 50 }}>Curr</th>
                      <th style={{ textAlign: "right", width: 110 }}>DR</th>
                      <th style={{ textAlign: "right", width: 110 }}>CR</th>
                      <th style={{ textAlign: "center", width: 36 }}>Sig</th>
                      <th style={{ textAlign: "center", width: 36 }}>Corr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(function(txn) {
                      const isExpanded = expandedId === txn.transaction_id;
                      const rowBg = txn.correlation_id ? corrColors.get(txn.correlation_id) : undefined;

                      return (
                        <>
                          <tr
                            key={txn.transaction_id + "-row"}
                            style={{ cursor: "pointer", background: rowBg || undefined }}
                            onClick={function() { setExpandedId(isExpanded ? null : txn.transaction_id); }}
                          >
                            <td style={{ fontSize: 12, fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>{fmtDate(txn.date)}</td>
                            <td style={{ fontSize: 13, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {txn.reference}
                            </td>
                            <td className="mono" style={{ fontSize: 11 }}>{shortHash(txn.transaction_id)}</td>
                            <td style={{ fontSize: 12 }}>{txn.transaction_type.replace(/_/g, " ")}</td>
                            <td style={{ fontSize: 12, color: "var(--text)" }}>{txn.source_module || ""}</td>
                            <td style={{ fontSize: 12, fontFamily: "var(--mono)" }}>{txn.currency}</td>
                            <td className="num" style={{ textAlign: "right" }}>
                              {txn.total_debit && parseFloat(txn.total_debit) > 0
                                ? <span className="mono">{fmtMoney(txn.total_debit)}</span>
                                : ""}
                            </td>
                            <td className="num" style={{ textAlign: "right" }}>
                              {txn.total_credit && parseFloat(txn.total_credit) > 0
                                ? <span className="mono">{fmtMoney(txn.total_credit)}</span>
                                : ""}
                            </td>
                            <td style={{ textAlign: "center", fontSize: 15 }}>
                              {txn.module_signature
                                ? <span title="Module signature present" style={{ color: "#16a34a" }}>&#128737;</span>
                                : ""}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              {txn.correlation_id
                                ? (
                                  <span
                                    title={"Corr: " + txn.correlation_id}
                                    style={{
                                      display: "inline-block", width: 9, height: 9,
                                      borderRadius: "50%", background: "#6366f1", verticalAlign: "middle",
                                    }}
                                  />
                                )
                                : ""}
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr key={txn.transaction_id + "-detail"}>
                              <td colSpan={10} style={{ padding: "14px 18px", background: "var(--code-bg)", borderBottom: "2px solid var(--accent-border)" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 24px", marginBottom: 14 }}>
                                  <div>
                                    <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Full Transaction ID</div>
                                    <div className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{txn.transaction_id}</div>
                                  </div>
                                  {txn.description && (
                                    <div>
                                      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Description</div>
                                      <div style={{ fontSize: 13 }}>{txn.description}</div>
                                    </div>
                                  )}
                                  {txn.chain_hash && (
                                    <div>
                                      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Chain Hash</div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span className="mono" style={{ fontSize: 11 }}>{shortHash(txn.chain_hash)}</span>
                                        <button
                                          className="btn btn-secondary btn-sm"
                                          style={{ fontSize: 10, padding: "1px 5px" }}
                                          onClick={function(e) {
                                            e.stopPropagation();
                                            navigator.clipboard.writeText(txn.chain_hash || "");
                                          }}
                                        >
                                          Copy
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  {txn.exchange_rate && txn.currency !== txn.base_currency && (
                                    <div>
                                      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Exchange Rate</div>
                                      <div className="mono" style={{ fontSize: 12 }}>
                                        {"1 " + txn.currency + " = " + txn.exchange_rate + " " + txn.base_currency}
                                      </div>
                                    </div>
                                  )}
                                  {txn.correlation_id && (
                                    <div>
                                      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Correlation ID</div>
                                      <div className="mono" style={{ fontSize: 11 }}>{txn.correlation_id}</div>
                                    </div>
                                  )}
                                  {txn.source_module && (
                                    <div>
                                      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Source Module</div>
                                      <div style={{ fontSize: 13 }}>{txn.source_module}</div>
                                    </div>
                                  )}
                                  <div>
                                    <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Supporting Document</div>
                                    <SupportingDocButton
                                      transactionId={txn.transaction_id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDocModalTxnId(txn.transaction_id);
                                      }}
                                    />
                                  </div>
                                </div>

                                {txn.lines && txn.lines.length > 0 && (
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                    <thead>
                                      <tr style={{ background: "var(--border)" }}>
                                        <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "var(--text)" }}>Account</th>
                                        <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "var(--text)" }}>Description</th>
                                        <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>Debit</th>
                                        <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>Credit</th>
                                        {txn.currency !== txn.base_currency && (
                                          <>
                                            <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>Base DR</th>
                                            <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>Base CR</th>
                                          </>
                                        )}
                                        <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "var(--text)" }}>CC</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {txn.lines.map(function(line) {
                                        return (
                                          <tr key={String(line.line_number)} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "5px 8px", fontFamily: "var(--mono)", fontSize: 12 }}>{line.account_code}</td>
                                            <td style={{ padding: "5px 8px", color: "var(--text)" }}>{line.description}</td>
                                            <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--mono)" }}>
                                              {parseFloat(line.debit) > 0 ? fmtMoney(line.debit) : ""}
                                            </td>
                                            <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--mono)" }}>
                                              {parseFloat(line.credit) > 0 ? fmtMoney(line.credit) : ""}
                                            </td>
                                            {txn.currency !== txn.base_currency && (
                                              <>
                                                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--mono)", color: "var(--text)" }}>
                                                  {parseFloat(line.base_debit) > 0 ? fmtMoney(line.base_debit) : ""}
                                                </td>
                                                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--mono)", color: "var(--text)" }}>
                                                  {parseFloat(line.base_credit) > 0 ? fmtMoney(line.base_credit) : ""}
                                                </td>
                                              </>
                                            )}
                                            <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--text)" }}>{line.cost_centre || ""}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              )
            }

            {total > PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                <button className="btn btn-secondary btn-sm" disabled={page <= 1}
                  onClick={function() { setPage(function(p) { return p - 1; }); }}>
                  Prev
                </button>
                <span style={{ fontSize: 13, alignSelf: "center" }}>{"Page " + String(page) + " / " + String(pageCount)}</span>
                <button className="btn btn-secondary btn-sm" disabled={page >= pageCount}
                  onClick={function() { setPage(function(p) { return p + 1; }); }}>
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {docModalTxnId && (
        <SupportingDocModal
          transactionId={docModalTxnId}
          onClose={() => setDocModalTxnId(null)}
        />
      )}
    </div>
  );
}

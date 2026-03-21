import { useState, useEffect, useCallback, useRef } from "react";
import { usePendingApprovals, useApproveTransaction, useRejectTransaction, useBulkApprove } from "../hooks/useApprovals";
import { fmtMoney, fmtDate, fmtDateTime } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";
import { Modal } from "../components/Modal";
import type { StagingEntry } from "../types/api";

const TX_TYPES = [
  "CUSTOMER_INVOICE", "CUSTOMER_CREDIT_NOTE", "CUSTOMER_PAYMENT", "BAD_DEBT_WRITE_OFF",
  "SUPPLIER_INVOICE", "SUPPLIER_CREDIT_NOTE", "SUPPLIER_PAYMENT",
  "STOCK_RECEIPT", "STOCK_DISPATCH", "STOCK_WRITE_OFF",
  "BANK_RECEIPT", "BANK_PAYMENT", "BANK_TRANSFER",
  "MANUAL_JOURNAL", "PRIOR_PERIOD_ADJUSTMENT", "PERIOD_END_ACCRUAL",
  "DEPRECIATION", "FX_REVALUATION",
];

type TabKey = "ALL" | "PENDING" | "PARTIALLY_APPROVED" | "ESCALATED";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "PARTIALLY_APPROVED", label: "Partially Approved" },
  { key: "ESCALATED", label: "Escalated" },
];

interface Toast {
  id: number;
  message: string;
  kind: "success" | "error";
}

function confidenceBadge(entry: StagingEntry): { cls: string; label: string } {
  const approvals = entry.approvals || [];
  const count = approvals.length;
  if (count === 0) return { cls: "badge badge-gray", label: "N/A" };
  if (count >= 2) return { cls: "badge badge-green", label: "High" };
  return { cls: "badge badge-amber", label: "Med" };
}

export function ApprovalQueue() {
  const [activeTab, setActiveTab] = useState<TabKey>("ALL");
  const [txTypeFilter, setTxTypeFilter] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [sourceModule, setSourceModule] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const filters: Record<string, string> = {};
  if (txTypeFilter) filters.transaction_type = txTypeFilter;
  if (amountMin) filters.amount_min = amountMin;
  if (amountMax) filters.amount_max = amountMax;
  if (sourceModule) filters.source_module = sourceModule;

  const { data: entries, isLoading, error } = usePendingApprovals(filters);
  const approveM = useApproveTransaction();
  const rejectM = useRejectTransaction();
  const bulkApproveM = useBulkApprove();

  const allEntries: StagingEntry[] = entries || [];

  const filtered = allEntries.filter(function(e) {
    if (activeTab === "ALL") return true;
    return e.status === activeTab;
  });

  function addToast(message: string, kind: "success" | "error") {
    const id = ++toastIdRef.current;
    setToasts(function(prev) { return prev.concat([{ id, message, kind }]); });
    setTimeout(function() {
      setToasts(function(prev) { return prev.filter(function(t) { return t.id !== id; }); });
    }, 3000);
  }

  function handleApprove(stagingId: string) {
    approveM.mutate({ stagingId }, {
      onSuccess: function() { addToast("Approved successfully", "success"); },
      onError: function(e) { addToast("Approval failed: " + (e as Error).message, "error"); },
    });
  }

  function handleRejectConfirm() {
    if (!rejectTarget || !rejectReason.trim()) return;
    rejectM.mutate({ stagingId: rejectTarget, reason: rejectReason }, {
      onSuccess: function() {
        addToast("Rejected successfully", "success");
        setRejectTarget(null);
        setRejectReason("");
      },
      onError: function(e) { addToast("Rejection failed: " + (e as Error).message, "error"); },
    });
  }

  function handleBulkApprove() {
    const ids = Array.from(selectedIds);
    bulkApproveM.mutate({ stagingIds: ids }, {
      onSuccess: function() {
        addToast("Approved " + String(ids.length) + " item(s) successfully", "success");
        setSelectedIds(new Set());
      },
      onError: function(e) { addToast("Bulk approval failed: " + (e as Error).message, "error"); },
    });
  }

  function handleBulkRejectConfirm() {
    if (!bulkRejectReason.trim()) return;
    const ids = Array.from(selectedIds);
    Promise.all(ids.map(function(id) {
      return rejectM.mutateAsync({ stagingId: id, reason: bulkRejectReason });
    })).then(function() {
      addToast("Rejected " + String(ids.length) + " item(s) successfully", "success");
      setSelectedIds(new Set());
      setBulkRejectOpen(false);
      setBulkRejectReason("");
    }).catch(function(e) {
      addToast("Bulk rejection failed: " + (e as Error).message, "error");
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds(function(prev) {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(function(e) { return e.staging_id; })));
    }
  }

  const handleKeyDown = useCallback(function(e: KeyboardEvent) {
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex(function(i) { return Math.min(i + 1, filtered.length - 1); });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex(function(i) { return Math.max(i - 1, 0); });
    } else if (e.key === "Enter" && focusedIndex >= 0 && filtered[focusedIndex]) {
      const fid = filtered[focusedIndex].staging_id;
      setExpandedId(function(prev) { return prev === fid ? null : fid; });
    } else if (e.key === "a" || e.key === "A") {
      if (focusedIndex >= 0 && filtered[focusedIndex]) {
        handleApprove(filtered[focusedIndex].staging_id);
      }
    } else if (e.key === "r" || e.key === "R") {
      if (focusedIndex >= 0 && filtered[focusedIndex]) {
        setRejectTarget(filtered[focusedIndex].staging_id);
        setRejectReason("");
      }
    }
  }, [filtered, focusedIndex]);

  useEffect(function() {
    document.addEventListener("keydown", handleKeyDown);
    return function() { document.removeEventListener("keydown", handleKeyDown); };
  }, [handleKeyDown]);

  const pendingCount = allEntries.filter(function(e) {
    return e.status === "PENDING" || e.status === "PARTIALLY_APPROVED";
  }).length;

  return (
    <div className="page">
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        {toasts.map(function(t) {
          return (
            <div
              key={t.id}
              style={{
                padding: "10px 18px", borderRadius: 6, fontSize: 14, fontWeight: 500,
                background: t.kind === "success" ? "#dcfce7" : "#fee2e2",
                color: t.kind === "success" ? "#15803d" : "#b91c1c",
                border: "1px solid " + (t.kind === "success" ? "#86efac" : "#fca5a5"),
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              }}
            >
              {t.message}
            </div>
          );
        })}
      </div>

      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>Approval Queue</h1>
          {pendingCount > 0 && <span className="badge badge-amber">{String(pendingCount)}</span>}
        </div>
        <div className="page-header-actions" style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={selectedIds.size === 0 || bulkApproveM.isPending}
            onClick={handleBulkApprove}
          >
            {"Approve Selected" + (selectedIds.size > 0 ? " (" + String(selectedIds.size) + ")" : "")}
          </button>
          <button
            className="btn btn-danger btn-sm"
            disabled={selectedIds.size === 0}
            onClick={function() { setBulkRejectOpen(true); setBulkRejectReason(""); }}
          >
            {"Reject Selected" + (selectedIds.size > 0 ? " (" + String(selectedIds.size) + ")" : "")}
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(function(tab) {
          return (
            <button
              key={tab.key}
              className={"tab" + (activeTab === tab.key ? " active" : "")}
              onClick={function() { setActiveTab(tab.key); setSelectedIds(new Set()); setFocusedIndex(-1); }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="page-toolbar">
        <select
          className="form-select"
          value={txTypeFilter}
          onChange={function(e) { setTxTypeFilter(e.target.value); }}
          style={{ width: 195 }}
        >
          <option value="">-- All types --</option>
          {TX_TYPES.map(function(t) {
            return <option key={t} value={t}>{t.replace(/_/g, " ")}</option>;
          })}
        </select>
        <input
          className="form-input"
          type="number"
          placeholder="Min amount"
          value={amountMin}
          onChange={function(e) { setAmountMin(e.target.value); }}
          style={{ width: 110 }}
        />
        <input
          className="form-input"
          type="number"
          placeholder="Max amount"
          value={amountMax}
          onChange={function(e) { setAmountMax(e.target.value); }}
          style={{ width: 110 }}
        />
        <input
          className="form-input"
          type="text"
          placeholder="Source module"
          value={sourceModule}
          onChange={function(e) { setSourceModule(e.target.value); }}
          style={{ width: 150 }}
        />
      </div>

      <div className="page-body">
        {isLoading && <div className="loading">Loading approval queue...</div>}
        {!isLoading && error && <div className="error-box">{"Error: " + (error as Error).message}</div>}
        {!isLoading && !error && filtered.length === 0 && <div className="empty">No items in queue</div>}

        {!isLoading && !error && filtered.length > 0 && (
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    title="Select all"
                  />
                </th>
                <th style={{ width: 90 }}>Date</th>
                <th>Reference</th>
                <th style={{ width: 160 }}>Type</th>
                <th style={{ width: 140 }}>Source Module</th>
                <th style={{ textAlign: "right", width: 120 }}>Amount</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 80 }}>Confidence</th>
                <th style={{ width: 24, textAlign: "center" }}>!</th>
                <th style={{ width: 150 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(entry, idx) {
                const isSelected = selectedIds.has(entry.staging_id);
                const isExpanded = expandedId === entry.staging_id;
                const isFocused = focusedIndex === idx;
                const conf = confidenceBadge(entry);
                return (
                  <>
                    <tr
                      key={entry.staging_id + "-row"}
                      style={{
                        cursor: "pointer",
                        background: isFocused ? "var(--code-bg)" : (isSelected ? "rgba(99,102,241,0.06)" : undefined),
                        outline: isFocused ? "1px solid var(--accent-border)" : undefined,
                      }}
                      onClick={function() {
                        setFocusedIndex(idx);
                        setExpandedId(isExpanded ? null : entry.staging_id);
                      }}
                    >
                      <td onClick={function(e) { e.stopPropagation(); }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={function() { toggleSelect(entry.staging_id); }}
                        />
                      </td>
                      <td style={{ fontSize: 12, fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>{fmtDate(entry.date)}</td>
                      <td style={{ fontSize: 13, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.reference}
                      </td>
                      <td style={{ fontSize: 12 }}>{entry.transaction_type.replace(/_/g, " ")}</td>
                      <td style={{ fontSize: 12, color: "var(--text)" }}>{entry.source_module || ""}</td>
                      <td style={{ textAlign: "right" }}>
                        <span className="mono" style={{ fontSize: 13 }}>
                          {entry.gross_amount ? fmtMoney(entry.gross_amount, entry.currency) : ""}
                        </span>
                      </td>
                      <td><StatusBadge status={entry.status} /></td>
                      <td><span className={conf.cls}>{conf.label}</span></td>
                      <td style={{ textAlign: "center" }}>
                        {entry.status === "ESCALATED"
                          ? <span title="Escalated" style={{ color: "#b91c1c", fontWeight: 700, fontSize: 15 }}>!</span>
                          : ""}
                      </td>
                      <td onClick={function(e) { e.stopPropagation(); }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={function() { handleApprove(entry.staging_id); }}
                            disabled={approveM.isPending}
                            title="Approve (A)"
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={function() { setRejectTarget(entry.staging_id); setRejectReason(""); }}
                            title="Reject (R)"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={entry.staging_id + "-detail"}>
                        <td colSpan={10} style={{ padding: "14px 18px", background: "var(--code-bg)", borderBottom: "2px solid var(--accent-border)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 20px", marginBottom: 12 }}>
                            <div>
                              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Staging ID</div>
                              <div className="mono" style={{ fontSize: 11 }}>{entry.staging_id}</div>
                            </div>
                            <div>
                              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Period</div>
                              <div style={{ fontSize: 13 }}>{entry.period_id}</div>
                            </div>
                            {entry.submitted_by && (
                              <div>
                                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Submitted By</div>
                                <div style={{ fontSize: 13 }}>{entry.submitted_by}</div>
                              </div>
                            )}
                            <div>
                              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Created At</div>
                              <div style={{ fontSize: 12 }}>{fmtDateTime(entry.created_at)}</div>
                            </div>
                            {entry.gross_amount && (
                              <div>
                                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Gross Amount</div>
                                <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                                  {fmtMoney(entry.gross_amount, entry.currency)}
                                </div>
                              </div>
                            )}
                          </div>

                          {entry.approvals && entry.approvals.length > 0 && (
                            <div>
                              <div className="muted" style={{ fontSize: 11, marginBottom: 6, fontWeight: 600 }}>Approval History</div>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                <thead>
                                  <tr style={{ background: "var(--border)" }}>
                                    <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600 }}>Approver</th>
                                    <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600 }}>Approved At</th>
                                    <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600 }}>Notes</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.approvals.map(function(a, i) {
                                    return (
                                      <tr key={String(i)} style={{ borderBottom: "1px solid var(--border)" }}>
                                        <td style={{ padding: "4px 8px" }}>{a.approved_by}</td>
                                        <td style={{ padding: "4px 8px", fontFamily: "var(--mono)", fontSize: 11 }}>{fmtDateTime(a.approved_at)}</td>
                                        <td style={{ padding: "4px 8px", color: "var(--text)" }}>{a.notes || ""}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {rejectTarget && (
        <Modal title="Reject Transaction" onClose={function() { setRejectTarget(null); setRejectReason(""); }}>
          <div style={{ padding: "0 0 16px 0" }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Please provide a reason for rejection. This will be recorded on the staging entry.
            </div>
            <label className="form-label">Reason (required)</label>
            <textarea
              className="form-input"
              value={rejectReason}
              onChange={function(e) { setRejectReason(e.target.value); }}
              rows={3}
              style={{ width: "100%", resize: "vertical", marginBottom: 4 }}
              placeholder="Enter rejection reason..."
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={function() { setRejectTarget(null); setRejectReason(""); }}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleRejectConfirm}
              disabled={!rejectReason.trim() || rejectM.isPending}
            >
              Confirm Reject
            </button>
          </div>
        </Modal>
      )}

      {bulkRejectOpen && (
        <Modal title={"Reject " + String(selectedIds.size) + " Item(s)"} onClose={function() { setBulkRejectOpen(false); setBulkRejectReason(""); }}>
          <div style={{ padding: "0 0 16px 0" }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Please provide a reason for rejecting all selected items.
            </div>
            <label className="form-label">Reason (required)</label>
            <textarea
              className="form-input"
              value={bulkRejectReason}
              onChange={function(e) { setBulkRejectReason(e.target.value); }}
              rows={3}
              style={{ width: "100%", resize: "vertical", marginBottom: 4 }}
              placeholder="Enter rejection reason..."
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={function() { setBulkRejectOpen(false); setBulkRejectReason(""); }}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleBulkRejectConfirm}
              disabled={!bulkRejectReason.trim() || rejectM.isPending}
            >
              Confirm Reject All
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

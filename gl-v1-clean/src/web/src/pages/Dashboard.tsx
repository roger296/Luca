import { Link } from "react-router-dom";
import { useCurrentPeriod } from "../hooks/usePeriods";
import { useTransactions } from "../hooks/useTransactions";
import { usePendingApprovals } from "../hooks/useApprovals";
import { useWebhooks } from "../hooks/useWebhooks";
import { useChainVerify } from "../hooks/useChain";
import { fmtMoney, fmtDate } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";

export function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: currentPeriod, isLoading: periodLoading } = useCurrentPeriod();
  const { data: approvalsData, isLoading: approvalsLoading } = usePendingApprovals();
  const { data: webhooks, isLoading: webhooksLoading } = useWebhooks();
  const { data: recentTxns, isLoading: txnsLoading } = useTransactions({ page: 1, page_size: 10 });

  const chainPeriod = currentPeriod ? currentPeriod.period_id : "";
  const { data: chainStatus, isLoading: chainLoading } = useChainVerify(chainPeriod);

  const pendingCount = approvalsData ? approvalsData.length : 0;
  const activeWebhooks = webhooks ? webhooks.filter(function(wh) { return wh.is_active; }) : [];
  const failedWebhooks = webhooks ? webhooks.filter(function(wh) { return wh.failure_count > 0; }) : [];
  const transactions = recentTxns ? recentTxns.transactions : [];
  const isSoftClose = currentPeriod && currentPeriod.status === "SOFT_CLOSE";
  const chainOk = chainStatus && chainStatus.valid;

  const reconMap = (currentPeriod && currentPeriod.sub_ledger_reconciliations) || {};
  const reconEntries = Object.entries(reconMap);
  const allReconConfirmed = reconEntries.length > 0 && reconEntries.every(function(e) { return e[1].confirmed; });
  const reconConfirmedCount = reconEntries.filter(function(e) { return e[1].confirmed; }).length;

  return (
    <div className="page">
      <div className="page-header">
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>Dashboard</h1>
        <span className="muted" style={{ fontSize: 13 }}>{today}</span>
      </div>

      <div className="page-body">
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <div className="card">
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text)", marginBottom: 8 }}>Current Period</div>
            {periodLoading
              ? <span className="loading" style={{ padding: 0 }}>Loading...</span>
              : currentPeriod
                ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-h)", fontFamily: "var(--mono)" }}>
                      {currentPeriod.period_id}
                    </span>
                    <StatusBadge status={currentPeriod.status} />
                  </div>
                )
                : <span className="muted" style={{ fontSize: 13 }}>No open period</span>
            }
          </div>

          <div className="card">
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text)", marginBottom: 8 }}>Pending Approvals</div>
            {approvalsLoading
              ? <span className="loading" style={{ padding: 0 }}>Loading...</span>
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Link
                    to="/approvals"
                    style={{ fontSize: 28, fontWeight: 700, color: pendingCount > 0 ? "#d97706" : "var(--text-h)", textDecoration: "none" }}
                  >
                    {pendingCount}
                  </Link>
                  {pendingCount > 0
                    ? <Link to="/approvals" style={{ fontSize: 12, color: "#d97706" }}>View queue</Link>
                    : <span style={{ fontSize: 12, color: "#16a34a" }}>Queue clear</span>
                  }
                </div>
              )
            }
          </div>

          <div className="card">
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text)", marginBottom: 8 }}>Chain Status</div>
            {chainLoading || !chainPeriod
              ? <span className="loading" style={{ padding: 0 }}>Loading...</span>
              : chainStatus
                ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-h)", fontFamily: "var(--mono)" }}>{chainPeriod}</span>
                      {chainOk
                        ? <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 18 }}>&#10003;</span>
                        : <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 18 }}>&#10007;</span>
                      }
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text)" }}>
                      {String(chainStatus.entries) + " entries" + (chainStatus.merkle_valid ? " • merkle ok" : "")}
                    </span>
                  </div>
                )
                : <span className="muted" style={{ fontSize: 13 }}>Not verified</span>
            }
          </div>

          <div className="card">
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text)", marginBottom: 8 }}>Webhooks</div>
            {webhooksLoading
              ? <span className="loading" style={{ padding: 0 }}>Loading...</span>
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-h)" }}>
                    {activeWebhooks.length}
                    <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text)", marginLeft: 6 }}>active</span>
                  </span>
                  {failedWebhooks.length > 0
                    ? <span className="badge badge-red">{String(failedWebhooks.length) + " failing"}</span>
                    : activeWebhooks.length > 0
                      ? <span style={{ fontSize: 12, color: "#16a34a" }}>All healthy</span>
                      : <span className="muted" style={{ fontSize: 12 }}>None configured</span>
                  }
                </div>
              )
            }
          </div>
        </div>

        {isSoftClose && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "var(--text-h)" }}>
              {"Period Closing Checklist — " + currentPeriod!.period_id}
            </h2>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: 260 }}>Check</th>
                  <th style={{ width: 130 }}>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Staging Area Clear</td>
                  <td>
                    <span className={"badge " + (pendingCount === 0 ? "badge-green" : "badge-amber")}>
                      {pendingCount === 0 ? "Clear" : "Pending items"}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {pendingCount === 0 ? "No pending approvals" : String(pendingCount) + " items awaiting approval"}
                  </td>
                </tr>
                <tr>
                  <td>Chain Integrity</td>
                  <td>
                    <span className={"badge " + (chainOk ? "badge-green" : "badge-amber")}>
                      {chainOk ? "Valid" : chainStatus ? "Invalid" : "Not checked"}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {chainStatus
                      ? (String(chainStatus.entries) + " entries, merkle " + (chainStatus.merkle_valid ? "ok" : "pending"))
                      : "Run chain verify to check"
                    }
                  </td>
                </tr>
                <tr>
                  <td>Sub-ledger Reconciliations</td>
                  <td>
                    <span className={"badge " + (allReconConfirmed ? "badge-green" : "badge-amber")}>
                      {allReconConfirmed ? "Confirmed" : reconEntries.length === 0 ? "None submitted" : "Partial"}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {reconEntries.length === 0
                      ? "Awaiting module confirmations"
                      : String(reconConfirmedCount) + " of " + String(reconEntries.length) + " confirmed"
                    }
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "var(--text-h)" }}>Recent Transactions</h2>
            <Link to="/journal" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>
              View full journal
            </Link>
          </div>

          {txnsLoading
            ? <div className="loading">Loading transactions...</div>
            : transactions.length === 0
              ? <div className="empty">No committed transactions found</div>
              : (
                <table className="tbl" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reference</th>
                      <th>Type</th>
                      <th>Currency</th>
                      <th style={{ textAlign: "right" }}>DR</th>
                      <th style={{ textAlign: "right" }}>CR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(function(txn) {
                      return (
                        <tr key={txn.transaction_id}>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(txn.date)}</td>
                          <td>
                            <Link
                              to={"/journal/" + txn.transaction_id}
                              style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}
                            >
                              {txn.reference}
                            </Link>
                          </td>
                          <td style={{ fontSize: 12, color: "var(--text)" }}>{txn.transaction_type.replace(/_/g, " ")}</td>
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
          }
        </div>
      </div>
    </div>
  );
}

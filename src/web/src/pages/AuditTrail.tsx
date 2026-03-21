import { useState } from "react";
import { useChainEntries, useChainVerify, useChainCheckpoint, useMerkleProof } from "../hooks/useChain";
import { fmtDateTime, shortHash } from "../lib/api";
import { PeriodSelector } from "../components/PeriodSelector";
import { Modal } from "../components/Modal";
import type { ChainEntry } from "../types/api";

type TabMode = "chain" | "verify";

function EntryTypeBadge({ type }: { type: string }) {
  if (type === "GENESIS") return <span className="badge badge-gray">GENESIS</span>;
  if (type === "PERIOD_CLOSE") return <span className="badge badge-green">PERIOD CLOSE</span>;
  return <span className="badge badge-blue">TRANSACTION</span>;
}

function ChainEntryRow({
  entry,
  prev,
  onProof,
}: {
  entry: ChainEntry;
  prev: ChainEntry | null;
  onProof: (txId: string) => void;
}) {
  const linkOk = prev === null || entry.previous_hash === prev.entry_hash;
  const txId =
    entry.type === "TRANSACTION" && entry.payload
      ? (entry.payload.transaction_id as string | undefined)
      : undefined;

  function copyHash() {
    navigator.clipboard.writeText(entry.entry_hash).catch(function() {});
  }

  return (
    <div className="chain-entry">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span className="chain-seq">{entry.sequence}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <EntryTypeBadge type={entry.type} />
            <span className="muted text-xs">{fmtDateTime(entry.timestamp)}</span>
            {txId && (
              <span className="mono text-xs" style={{ color: "var(--text)" }}>{txId}</span>
            )}
            <span className={linkOk ? "chain-ok" : "chain-bad"}>
              {linkOk ? "✓ linked" : "✗ broken"}
            </span>
          </div>
          <div style={{ marginTop: 4 }}>
            <span className="text-xs muted" style={{ marginRight: 6 }}>hash:</span>
            <span className="chain-hash">{shortHash(entry.entry_hash)}</span>
            <span className="text-xs muted" style={{ marginLeft: 12, marginRight: 6 }}>prev:</span>
            <span className="chain-hash muted">{shortHash(entry.previous_hash)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={copyHash}>Copy Hash</button>
          {entry.type === "TRANSACTION" && txId && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={function() { onProof(txId); }}
            >
              Merkle Proof
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProofModal({ txId, onClose }: { txId: string; onClose: () => void }) {
  const { data, isLoading, error } = useMerkleProof(txId);

  return (
    <Modal title={"Merkle Proof: " + txId} onClose={onClose}>
      <div style={{ padding: "0 0 12px" }}>
        {isLoading && <div className="loading">Generating proof...</div>}
        {error && <div className="error-box">{"Error: " + (error as Error).message}</div>}
        {(data as object) && (
          <div>
            <div className="text-sm" style={{ marginBottom: 8 }}>
              <span className="muted">Leaf hash: </span>
              <span className="mono">{(data as Record<string, string>).leaf_hash || ""}</span>
            </div>
            <div className="text-sm" style={{ marginBottom: 8 }}>
              <span className="muted">Merkle root: </span>
              <span className="mono">{(data as Record<string, string>).merkle_root || ""}</span>
            </div>
            <div className="text-sm font-semibold" style={{ marginBottom: 4 }}>Proof path:</div>
            {((data as Record<string, unknown[]>).proof_path || ([] as unknown[])).map(function(step: unknown, i: number) {
              const s = step as Record<string, string>;
              return (
                <div key={i} className="chain-entry" style={{ marginBottom: 4 }}>
                  <span className="badge badge-gray" style={{ marginRight: 6 }}>{s.position}</span>
                  <span className="mono text-xs">{s.hash}</span>
                </div>
              );
            })}
            {((data as Record<string, unknown[]>).proof_path || ([] as unknown[])).length === 0 && (
              <div className="muted text-sm">No proof path (single-entry tree).</div>
            )}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function ChainView({ period }: { period: string }) {
  const [proofTxId, setProofTxId] = useState<string | null>(null);
  const { data: entries, isLoading, error } = useChainEntries(period);

  if (!period) {
    return <div className="empty">Select a period to view chain entries.</div>;
  }
  if (isLoading) {
    return <div className="loading">Loading chain entries...</div>;
  }
  if (!isLoading && (error || !entries)) {
    return (
      <div style={{ padding: 24 }}>
        <div className="error-box" style={{ marginBottom: 12 }}>
          Chain entries endpoint not available. Use Verification mode to verify integrity.
        </div>
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return <div className="empty">{"No chain entries found for period " + period + "."}</div>;
  }

  return (
    <div>
      <div className="text-sm muted" style={{ marginBottom: 10 }}>
        {entries.length + " entries in period " + period}
      </div>
      <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 280px)" }}>
        {entries.map(function(entry: ChainEntry, i: number) {
          return (
            <ChainEntryRow
              key={entry.sequence}
              entry={entry}
              prev={i > 0 ? entries[i - 1] : null}
              onProof={setProofTxId}
            />
          );
        })}
      </div>
      {proofTxId && (
        <ProofModal txId={proofTxId} onClose={function() { setProofTxId(null); }} />
      )}
    </div>
  );
}

function VerificationView({ period }: { period: string }) {
  const [run, setRun] = useState(false);
  const [manualTxId, setManualTxId] = useState("");
  const [proofTxId, setProofTxId] = useState<string | null>(null);

  const verifyQuery = useChainVerify(period);
  const checkpointQuery = useChainCheckpoint(period);

  function handleVerify() {
    setRun(true);
    verifyQuery.refetch();
  }

  const result = run ? verifyQuery.data : null;
  const resultError = run ? verifyQuery.error : null;

  return (
    <div style={{ maxWidth: 700 }}>
      {!period && <div className="empty">Select a period to run verification.</div>}
      {period && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
            <button
              className="btn btn-primary"
              onClick={handleVerify}
              disabled={verifyQuery.isFetching}
            >
              {verifyQuery.isFetching ? "Verifying..." : "Verify Chain Integrity"}
            </button>
          </div>

          {verifyQuery.isFetching && (
            <div className="loading">{"Verifying chain integrity for period " + period + "..."}</div>
          )}

          {!verifyQuery.isFetching && resultError && (
            <div className="error-box">{"Verification error: " + (resultError as Error).message}</div>
          )}

          {!verifyQuery.isFetching && result && (
            <div
              style={{
                padding: "14px 18px",
                borderRadius: 6,
                marginBottom: 20,
                background: result.valid ? "#f0fdf4" : "#fef2f2",
                border: "1px solid " + (result.valid ? "#16a34a" : "#dc2626"),
              }}
            >
              {result.valid ? (
                <div>
                  <div className="font-bold" style={{ color: "#16a34a", marginBottom: 4 }}>
                    Chain valid
                  </div>
                  <div className="text-sm">
                    {result.entries + " entries verified."}
                    {result.merkle_valid !== undefined && (
                      <span>
                        {" Merkle tree: "}
                        <span style={{ color: result.merkle_valid ? "#16a34a" : "#dc2626" }}>
                          {result.merkle_valid ? "valid" : "INVALID"}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-bold" style={{ color: "#dc2626", marginBottom: 4 }}>
                    Chain integrity failure
                  </div>
                  <div className="text-sm">{result.error || "Unknown error"}</div>
                </div>
              )}
            </div>
          )}

          {checkpointQuery.data && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title">Period Checkpoint</div>
              <table className="tbl">
                <tbody>
                  <tr>
                    <td className="text-sm muted" style={{ width: 160 }}>Closing Hash</td>
                    <td className="mono text-xs">{checkpointQuery.data.closing_hash}</td>
                  </tr>
                  <tr>
                    <td className="text-sm muted">Merkle Root</td>
                    <td className="mono text-xs">{checkpointQuery.data.merkle_root}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <div className="card-title">Generate Merkle Proof</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                className="form-input"
                placeholder="Transaction ID (e.g. TXN-2026-03-00001)"
                value={manualTxId}
                onChange={function(e) { setManualTxId(e.target.value); }}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary btn-sm"
                disabled={!manualTxId.trim()}
                onClick={function() { setProofTxId(manualTxId.trim()); }}
              >
                Generate Proof
              </button>
            </div>
          </div>

          {proofTxId && (
            <ProofModal txId={proofTxId} onClose={function() { setProofTxId(null); }} />
          )}
        </>
      )}
    </div>
  );
}

export function AuditTrail() {
  const [period, setPeriod] = useState("2026-03");
  const [mode, setMode] = useState<TabMode>("chain");

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>
            Audit Trail
          </h1>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="page-toolbar">
        <div className="tabs">
          <button
            className={"tab" + (mode === "chain" ? " active" : "")}
            onClick={function() { setMode("chain"); }}
          >
            Chain View
          </button>
          <button
            className={"tab" + (mode === "verify" ? " active" : "")}
            onClick={function() { setMode("verify"); }}
          >
            Verification
          </button>
        </div>
      </div>

      <div className="page-body">
        {mode === "chain" ? (
          <ChainView period={period} />
        ) : (
          <VerificationView period={period} />
        )}
      </div>
    </div>
  );
}

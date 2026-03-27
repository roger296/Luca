import { useState, useEffect, useCallback } from "react";
import { Modal } from "./Modal";
import { useTransactionDocuments, fetchDocumentBlob } from "../hooks/useTransactionDocuments";

interface SupportingDocModalProps {
  transactionId: string;
  onClose: () => void;
}

export function SupportingDocModal({ transactionId, onClose }: SupportingDocModalProps) {
  const { data: docs, isLoading, error } = useTransactionDocuments(transactionId);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  // Auto-load first document when docs are available
  const loadDocument = useCallback(async (docId: string) => {
    setIsFetching(true);
    setFetchError(null);
    setBlobUrl(null);
    try {
      const result = await fetchDocumentBlob(transactionId, docId);
      setBlobUrl(result.blobUrl);
      setMimeType(result.mimeType);
      setFilename(result.filename);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load document");
    } finally {
      setIsFetching(false);
    }
  }, [transactionId]);

  useEffect(() => {
    if (docs && docs.length > 0 && !blobUrl && !isFetching) {
      loadDocument(docs[0].id);
    }
  }, [docs, blobUrl, isFetching, loadDocument]);

  // Revoke object URL on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  return (
    <Modal title="Supporting Document" onClose={onClose}>
      <div style={{ minWidth: 600, maxWidth: "80vw" }}>

        {/* Loading / error states */}
        {isLoading && (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text)" }}>
            Loading document list…
          </div>
        )}
        {error && (
          <div style={{ padding: "24px", color: "#dc2626" }}>
            Could not load document list: {error instanceof Error ? error.message : "Unknown error"}
          </div>
        )}

        {/* No documents */}
        {!isLoading && !error && docs && docs.length === 0 && (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text)" }}>
            No supporting documents are attached to this transaction.
          </div>
        )}

        {/* Document list (show if more than one doc) */}
        {docs && docs.length > 1 && (
          <div style={{ marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {docs.map((doc) => (
              <button
                key={doc.id}
                className="btn btn-secondary btn-sm"
                onClick={() => loadDocument(doc.id)}
                style={{ fontSize: 12 }}
              >
                {doc.filename}
              </button>
            ))}
          </div>
        )}

        {/* Document viewer */}
        {docs && docs.length > 0 && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "#f9f9f9" }}>
            {isFetching && (
              <div style={{ height: 480, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text)" }}>
                Loading document…
              </div>
            )}
            {fetchError && (
              <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", padding: 24 }}>
                {fetchError}
              </div>
            )}
            {blobUrl && isPdf && (
              <iframe
                src={blobUrl}
                title={filename}
                style={{ width: "100%", height: 600, border: "none", display: "block" }}
              />
            )}
            {blobUrl && isImage && (
              <div style={{ padding: 12, display: "flex", justifyContent: "center", background: "#f0f0f0" }}>
                <img
                  src={blobUrl}
                  alt={filename}
                  style={{ maxWidth: "100%", maxHeight: 580, objectFit: "contain", display: "block" }}
                />
              </div>
            )}
            {blobUrl && !isPdf && !isImage && (
              <div style={{ padding: 24, textAlign: "center" }}>
                <p style={{ marginBottom: 12, color: "var(--text)" }}>
                  Preview not available for <strong>{filename}</strong>
                </p>
                <a
                  href={blobUrl}
                  download={filename}
                  className="btn btn-primary btn-sm"
                >
                  Download file
                </a>
              </div>
            )}
          </div>
        )}

        {/* Footer: filename + close */}
        {blobUrl && filename && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{filename}</span>
            <a href={blobUrl} download={filename} className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}>
              Download
            </a>
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

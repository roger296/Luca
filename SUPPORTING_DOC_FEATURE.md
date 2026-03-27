# Feature: Supporting Document Viewer

## Overview

Add the ability to attach a supporting document (PDF, image, etc.) to any posted transaction and view it from the Journal UI via a "View Supporting Doc" button. Clicking the button opens a modal showing the original source document.

---

## What to build

### 1. Database migration — `transaction_documents` table

Create a new Knex migration file at:
`src/db/migrations/20260326000001_create_transaction_documents.ts`

```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transaction_documents', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Logical FK to transactions.transaction_id
    table.string('transaction_id', 30).notNullable();
    table.string('filename', 255).notNullable();
    table.string('mime_type', 100).notNullable();
    // File stored as base64 text in the DB (avoids filesystem management complexity)
    table.text('file_data').notNullable();
    table.bigInteger('file_size').notNullable();
    table.string('uploaded_by', 255).nullable();
    table.timestamp('uploaded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['transaction_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('transaction_documents');
}
```

Run `npx knex migrate:latest --knexfile knexfile.ts` (or whatever the project's migration command is) to apply it.

---

### 2. DB query helpers — `src/db/queries/documents.ts` (new file)

```typescript
import { db } from "../connection";

export interface TransactionDocument {
  id: string;
  transaction_id: string;
  filename: string;
  mime_type: string;
  file_data: string; // base64
  file_size: number;
  uploaded_by: string | null;
  uploaded_at: string;
}

export async function getDocumentsForTransaction(
  transaction_id: string
): Promise<Omit<TransactionDocument, "file_data">[]> {
  return db("transaction_documents")
    .where({ transaction_id })
    .select("id", "transaction_id", "filename", "mime_type", "file_size", "uploaded_by", "uploaded_at")
    .orderBy("uploaded_at", "asc");
}

export async function getDocumentById(id: string): Promise<TransactionDocument | undefined> {
  return db("transaction_documents").where({ id }).first();
}

export async function insertDocument(doc: {
  transaction_id: string;
  filename: string;
  mime_type: string;
  file_data: string;
  file_size: number;
  uploaded_by?: string | null;
}): Promise<TransactionDocument> {
  const [inserted] = await db("transaction_documents").insert(doc).returning("*");
  return inserted;
}

export async function deleteDocument(id: string): Promise<void> {
  await db("transaction_documents").where({ id }).delete();
}
```

---

### 3. API handler — `src/api/documents.ts` (new file)

This handles listing documents, uploading, serving file data, and deletion.

```typescript
import type { Request, Response, NextFunction } from "express";
import * as documentsDb from "../db/queries/documents";
import * as transactionsDb from "../db/queries/transactions";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
];

/** GET /transactions/:id/documents — list metadata (no file_data) */
export async function listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    // Verify the transaction exists
    const txn = await transactionsDb.getTransaction(id);
    if (!txn) {
      res.status(404).json({ success: false, error: { code: "TRANSACTION_NOT_FOUND", message: `Transaction ${id} not found` } });
      return;
    }
    const docs = await documentsDb.getDocumentsForTransaction(id);
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
}

/** POST /transactions/:id/documents — upload a document (JSON body with base64) */
export async function uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { filename, mime_type, file_data } = req.body as {
      filename?: string;
      mime_type?: string;
      file_data?: string; // base64 encoded file content
    };

    if (!filename || !mime_type || !file_data) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "filename, mime_type, and file_data are required" } });
      return;
    }
    if (!ALLOWED_MIME_TYPES.includes(mime_type)) {
      res.status(400).json({ success: false, error: { code: "UNSUPPORTED_FILE_TYPE", message: `Unsupported file type: ${mime_type}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}` } });
      return;
    }

    const buffer = Buffer.from(file_data, "base64");
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      res.status(400).json({ success: false, error: { code: "FILE_TOO_LARGE", message: "File exceeds 10 MB limit" } });
      return;
    }

    // Verify the transaction exists
    const txn = await transactionsDb.getTransaction(id);
    if (!txn) {
      res.status(404).json({ success: false, error: { code: "TRANSACTION_NOT_FOUND", message: `Transaction ${id} not found` } });
      return;
    }

    const uploaded_by = (req as Request & { user?: { username?: string } }).user?.username ?? null;

    const doc = await documentsDb.insertDocument({
      transaction_id: id,
      filename,
      mime_type,
      file_data,
      file_size: buffer.byteLength,
      uploaded_by,
    });

    // Return metadata only (omit file_data from response)
    const { file_data: _omit, ...meta } = doc;
    res.status(201).json({ success: true, data: meta });
  } catch (err) { next(err); }
}

/** GET /transactions/:id/documents/:doc_id/file — stream the file bytes */
export async function serveDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_id } = req.params;
    const doc = await documentsDb.getDocumentById(doc_id);
    if (!doc) {
      res.status(404).json({ success: false, error: { code: "DOCUMENT_NOT_FOUND", message: `Document ${doc_id} not found` } });
      return;
    }
    const buffer = Buffer.from(doc.file_data, "base64");
    res.setHeader("Content-Type", doc.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename}"`);
    res.setHeader("Content-Length", String(buffer.byteLength));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (err) { next(err); }
}

/** DELETE /transactions/:id/documents/:doc_id */
export async function deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { doc_id } = req.params;
    const doc = await documentsDb.getDocumentById(doc_id);
    if (!doc) {
      res.status(404).json({ success: false, error: { code: "DOCUMENT_NOT_FOUND", message: `Document ${doc_id} not found` } });
      return;
    }
    await documentsDb.deleteDocument(doc_id);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}
```

---

### 4. Register new routes in `src/api/routes.ts`

Add these imports and routes. Insert them in the Transactions section, immediately after the existing `router.get("/transactions/:id", ...)` line:

```typescript
import * as documents from "./documents";

// ─── Transaction Documents ─────────────────────────────────────────────────
router.get("/transactions/:id/documents", documents.listDocuments);
router.post("/transactions/:id/documents", documents.uploadDocument);
router.get("/transactions/:id/documents/:doc_id/file", documents.serveDocument);
router.delete("/transactions/:id/documents/:doc_id", documents.deleteDocument);
```

---

### 5. Frontend — new hook `src/web/src/hooks/useTransactionDocuments.ts`

```typescript
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { useAuthStore } from "../store/authStore";

export interface TransactionDocumentMeta {
  id: string;
  transaction_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string | null;
  uploaded_at: string;
}

export function useTransactionDocuments(transactionId: string | null) {
  return useQuery<TransactionDocumentMeta[]>({
    queryKey: ["transaction-documents", transactionId],
    queryFn: () => apiFetch<TransactionDocumentMeta[]>(`/transactions/${transactionId}/documents`),
    enabled: !!transactionId,
  });
}

/** Returns a fully-authenticated URL for fetching a document file as a blob.
 *  Call getDocumentBlobUrl() to get a temporary object URL for display. */
export async function fetchDocumentBlob(
  transactionId: string,
  docId: string
): Promise<{ blobUrl: string; mimeType: string; filename: string }> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`/api/v1/gl/transactions/${transactionId}/documents/${docId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to fetch document: ${res.status}`);
  const mimeType = res.headers.get("Content-Type") ?? "application/octet-stream";
  const contentDisposition = res.headers.get("Content-Disposition") ?? "";
  const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch ? filenameMatch[1] : "document";
  const blob = await res.blob();
  return { blobUrl: URL.createObjectURL(blob), mimeType, filename };
}
```

---

### 6. Frontend — new component `src/web/src/components/SupportingDocModal.tsx`

```tsx
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
```

---

### 7. Update `src/web/src/pages/Journal.tsx`

The expanded transaction detail row currently shows metadata, chain hash, source module, etc. Add the "View Supporting Doc" button to this section.

**Changes required:**

a) Add import at the top of the file:
```tsx
import { SupportingDocModal } from "../components/SupportingDocModal";
import { useTransactionDocuments } from "../hooks/useTransactionDocuments";
```

b) Inside the `Journal()` component, add a state variable to track which transaction's doc modal is open:
```tsx
const [docModalTxnId, setDocModalTxnId] = useState<string | null>(null);
```

c) In the expanded row detail section, after the chain hash block and before or after the Source Module block, add a new grid cell for the button:

Locate the block that renders `txn.source_module` and add after it:

```tsx
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
```

d) Add the modal at the bottom of the `return` block, just before the closing `</div>`:
```tsx
{docModalTxnId && (
  <SupportingDocModal
    transactionId={docModalTxnId}
    onClose={() => setDocModalTxnId(null)}
  />
)}
```

e) Create a small inline helper component `SupportingDocButton` near the top of `Journal.tsx` (or in a separate file) that queries the document count and conditionally renders the button:

```tsx
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
```

> **Note on performance:** Each expanded row will make one API call to `/transactions/:id/documents`. Since rows are only expanded one at a time, this is fine. React Query will cache the result so re-opening the same row doesn't re-fetch.

---

### 8. Add modal CSS to `src/web/src/index.css`

The existing `Modal` component uses `.modal-overlay` and `.modal` classes. If these aren't already styled, add:

```css
/* Modal overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-h);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
```

Only add the rules that are not already present.

---

### 9. MCP tool — add optional `supporting_document` parameter to `gl_post_transaction`

The MCP `gl_post_transaction` tool should be updated so that when Luca processes a document (invoice/receipt), it can attach the original file to the transaction at posting time.

Find the MCP tool definition for `gl_post_transaction` in `src/mcp/tools.ts` and add an optional input parameter to the schema:

```typescript
supporting_document: z.object({
  filename: z.string().describe("Original filename, e.g. 'invoice-001.pdf'"),
  mime_type: z.string().describe("MIME type, e.g. 'application/pdf' or 'image/jpeg'"),
  file_data: z.string().describe("Base64-encoded file content"),
}).optional().describe("Optional supporting document to attach to this transaction"),
```

In the tool handler (`handlePostTransaction`), after a successful `postTransaction()` call that returns `status === 'POSTED'`, check for `supporting_document` and if present call the documents DB helper:

```typescript
if (args.supporting_document && result.status === "POSTED" && result.transaction_id) {
  const { insertDocument } = await import("../db/queries/documents");
  await insertDocument({
    transaction_id: result.transaction_id,
    filename: args.supporting_document.filename,
    mime_type: args.supporting_document.mime_type,
    file_data: args.supporting_document.file_data,
    file_size: Buffer.from(args.supporting_document.file_data, "base64").byteLength,
    uploaded_by: "mcp-agent",
  });
}
```

---

### 10. Update the `gl-document-posting` skill to attach source files automatically

The file `lucas-general-ledger-document-posting/SKILL.md` is the skill Luca follows when posting financial documents. It needs a new step inserted between the current **Step 6 (Post the Transaction)** and **Step 7 (Verify the Posting)** so that Luca automatically uploads the source file to the GL immediately after every successful posting.

**Add a new "Step 6b — Attach the Supporting Document" section** to `SKILL.md` at that location:

````markdown
### Step 6b — Attach the Supporting Document

After a successful posting (HTTP 201 response with a `transaction_id`), attach the original source
document to the transaction so it can be viewed from the GL Journal UI.

This step only applies when there is a **physical source document** — a PDF, image, or similar file
that was read from the inbox or uploaded by the user. Skip this step for:
- Transactions derived entirely from a verbal instruction (no file involved)
- Manual journal entries with no source document
- Transactions that were already posted in a prior session (re-runs)

#### How to attach the document

1. **Read the source file as base64.** Use a bash command to encode the original file:

```bash
FILE_B64=$(base64 -w 0 "/path/to/original/document.pdf")
```

Replace the path with the actual path to the file that was used to create the transaction
(e.g. the file from the inbox folder that was read in Step 1).

2. **Determine the MIME type** from the file extension:
   - `.pdf` → `application/pdf`
   - `.jpg` / `.jpeg` → `image/jpeg`
   - `.png` → `image/png`
   - `.gif` → `image/gif`
   - `.webp` → `image/webp`
   - `.tiff` → `image/tiff`

3. **Post to the documents endpoint:**

```bash
curl -s -X POST "http://host.docker.internal:3000/api/v1/gl/transactions/${TXN_ID}/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"filename\": \"acme-invoice-INV-001.pdf\",
    \"mime_type\": \"application/pdf\",
    \"file_data\": \"${FILE_B64}\"
  }" | python3 -m json.tool
```

Where `$TXN_ID` is the transaction ID returned by the posting in Step 6 (e.g. `TXN-2026-03-00005`).

A successful response will be HTTP 201 with the document metadata (id, filename, file_size, etc.).

4. **Confirm to the user** — include a brief note in your Step 7 summary:

> "Supporting document attached — it can be viewed from the Journal by expanding the transaction
> and clicking **View Supporting Doc**."

If the attachment call fails (e.g. file too large, unsupported type, network error), log the error
but **do not treat it as a failure of the transaction posting** — the transaction is already safely
posted. Simply note it to the user:

> "The transaction was posted successfully, but I was unable to attach the supporting document
> automatically. You can attach it manually from the Journal UI."
````

**Also update the existing Step 6 payload example** — remove the non-functional `metadata` block from the JSON payload example (it is not a real field in the API) and replace it with a comment directing the reader to Step 6b:

Old JSON example ending (remove this):
```json
  "metadata": {
    "supplier": "Acme Corp",
    "document_type": "Supplier Invoice",
    "original_document": "invoice_acme_001.pdf"
  }
```

Replace with (in the Field notes section):
```
- `source.module_reference`: Set this to the document reference number (invoice number, etc.).
  The original file itself is attached separately in Step 6b — do not attempt to embed file data
  in the transaction payload.
```

---

## Testing checklist

After implementation, verify:

1. **Migration runs cleanly** — `transaction_documents` table appears in the database.
2. **API — upload** — `POST /api/v1/gl/transactions/TXN-2026-03-00001/documents` with JSON body `{ filename, mime_type, file_data }` returns 201.
3. **API — list** — `GET /api/v1/gl/transactions/TXN-2026-03-00001/documents` returns the document metadata array.
4. **API — serve** — `GET /api/v1/gl/transactions/TXN-2026-03-00001/documents/{id}/file` returns the file bytes with correct `Content-Type`.
5. **Frontend** — expanding a transaction row shows the "Supporting Document" section.
6. **Frontend** — if no document is attached, shows "None attached".
7. **Frontend** — if a document is attached, "View Supporting Doc" button is visible.
8. **Frontend** — clicking the button opens the modal and renders a PDF (in an `<iframe>`) or image correctly.
9. **Frontend** — modal close button / overlay click closes the modal and revokes the blob URL.
10. **MCP tool** — posting a transaction with `supporting_document` field attaches the doc and makes it visible in the UI.
11. **End-to-end via skill** — ask Luca to post one of the invoices in the inbox (e.g. `acme-stationery-AS-00122.pdf`). Confirm that after posting: (a) the transaction appears in the Journal, (b) expanding it shows the "View Supporting Doc" button, and (c) clicking the button opens the original PDF in the modal.

---

## Notes & constraints

- **File size limit**: 10 MB per document (enforced on both backend and should be communicated in the UI).
- **Allowed types**: PDF, JPEG, PNG, GIF, WebP, TIFF.
- **Storage**: Files are stored as base64 text in the `transaction_documents` Postgres table. For a small-scale accounting package this is simple and reliable. If file volumes grow significantly, migrate to object storage (S3/MinIO) later — the DB would then store a URL/key instead of `file_data`.
- **Auth**: The file-serve endpoint (`/documents/:doc_id/file`) is protected by the same `authenticate` middleware as all other GL routes. The frontend fetches the file via `fetch()` with the Bearer token, converts to a blob URL for display.
- **Multiple documents**: The schema and API support multiple documents per transaction. The UI shows individual tab buttons when more than one document is attached, but defaults to showing the first one automatically.
- **Deletion**: A DELETE endpoint is provided for future use (e.g. an admin UI). It is not surfaced in the Journal UI in this initial implementation.

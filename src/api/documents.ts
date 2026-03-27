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

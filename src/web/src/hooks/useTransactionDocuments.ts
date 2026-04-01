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
 *  Call fetchDocumentBlob() to get a temporary object URL for display. */
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

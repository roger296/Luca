import { knex as db } from "../connection";

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

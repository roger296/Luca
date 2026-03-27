import type { Request, Response, NextFunction } from "express";
import { postTransaction, postBulk } from "../engine/posting";
import * as transactionsDb from "../db/queries/transactions";
import type { TransactionSubmission, PostingResult } from "../engine/types";

export async function submitTransaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const submission = req.body as TransactionSubmission;
    const result: PostingResult = await postTransaction(submission);
    let statusCode = result.status === "POSTED" ? 201 : result.status === "AWAITING_APPROVAL" ? 202 : 422;
    res.status(statusCode).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function submitBulkTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { transactions } = req.body as { transactions: TransactionSubmission[] };
    if (!Array.isArray(transactions) || transactions.length === 0) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "transactions must be a non-empty array" } });
      return;
    }
    const results: PostingResult[] = await postBulk(transactions);
    let posted = 0; let awaitingApproval = 0; let rejected = 0;
    for (const r of results) {
      if (r.status === "POSTED") posted++;
      else if (r.status === "AWAITING_APPROVAL") awaitingApproval++;
      else rejected++;
    }
    const enriched = results.map((r, i) => ({ idempotency_key: transactions[i]?.idempotency_key ?? null, ...r }));
    res.status(207).json({ success: true, data: { results: enriched, summary: { total: results.length, posted, awaiting_approval: awaitingApproval, rejected } } });
  } catch (err) { next(err); }
}

export async function getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as Record<string, string | undefined>;
    const pageNum = q.page !== undefined ? Math.max(parseInt(q.page, 10), 1) : 1;
    const pageSizeNum = q.page_size !== undefined ? parseInt(q.page_size, 10) : 50;
    const { data, total } = await transactionsDb.listTransactions({
      period_id: q.period, date_from: q.date_from, date_to: q.date_to,
      transaction_type: q.transaction_type, account_code: q.account_code,
      counterparty_trading_account_id: q.counterparty_trading_account_id,
      correlation_id: q.correlation_id, reference: q.reference,
      source_module: q.source_module, currency: q.currency,
      page: pageNum, page_size: pageSizeNum,
      sort_by: q.sort_by, sort_order: q.sort_order,
    });
    res.json({ success: true, data: { transactions: data, pagination: { page: pageNum, page_size: pageSizeNum, total, total_pages: Math.ceil(total / pageSizeNum) } } });
  } catch (err) { next(err); }
}

export async function getTransactionById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const transaction = await transactionsDb.getTransaction(id);
    if (!transaction) {
      res.status(404).json({ success: false, error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction " + id + " not found" } });
      return;
    }
    res.json({ success: true, data: transaction });
  } catch (err) { next(err); }
}

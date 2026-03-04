import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../db/connection';
import { postTransaction } from '../engine/post';
import type { TransactionSubmission } from '../engine/types';

// ---------------------------------------------------------------------------
// transactions.ts — Transaction posting and query endpoints
// ---------------------------------------------------------------------------

export const transactionsRouter = Router();

/** GET /api/transactions?period_id=&type=&search=&limit=&offset= */
transactionsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period_id, type, search, limit = '50', offset = '0' } =
      req.query as Record<string, string | undefined>;

    let query = db('transactions').orderBy('date', 'desc').orderBy('transaction_id', 'desc');

    if (period_id) query = query.where('period_id', period_id);
    if (type) query = query.where('transaction_type', type);
    if (search) {
      query = query.where(function () {
        this.where('reference', 'ilike', `%${search}%`)
          .orWhere('description', 'ilike', `%${search}%`)
          .orWhere('transaction_id', 'ilike', `%${search}%`);
      });
    }

    const total = await query.clone().count<[{ count: string }]>('transaction_id as count').first();
    const rows = await query.limit(parseInt(limit, 10)).offset(parseInt(offset, 10));

    res.json({
      success: true,
      data: rows,
      total: parseInt(total?.count ?? '0', 10),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/transactions/:id — transaction with lines */
transactionsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    const txn = await db('transactions').where('transaction_id', id).first();
    if (!txn) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Transaction ${id} not found` } });
      return;
    }
    const lines = await db('transaction_lines')
      .where('transaction_id', id)
      .orderBy('debit', 'desc');
    res.json({ success: true, data: { ...txn, lines } });
  } catch (err) {
    next(err);
  }
});

/** POST /api/transactions */
transactionsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const submission = req.body as TransactionSubmission;
    const result = await postTransaction(submission);
    const status = result.status === 'COMMITTED' ? 201 : 202;
    res.status(status).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

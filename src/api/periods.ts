import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { ChainWriter } from '../chain/writer';
import { config } from '../config';
import { db } from '../db/connection';
import { hardClosePeriod, softClosePeriod } from '../engine/periods';

// ---------------------------------------------------------------------------
// periods.ts — Period management endpoints
// ---------------------------------------------------------------------------

export const periodsRouter = Router();

function makeChainWriter(): ChainWriter {
  return new ChainWriter({
    chainDir: config.chainDir,
    getPeriodStatus: async (periodId) => {
      const row = await db('periods')
        .where('period_id', periodId)
        .select('status')
        .first<{ status: string } | undefined>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
}

/** GET /api/periods */
periodsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('periods').orderBy('period_id', 'desc');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/** GET /api/periods/current — most recent OPEN period */
periodsRouter.get('/current', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('periods').where('status', 'OPEN').orderBy('period_id', 'desc').first();
    if (!row) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No open period found' } });
      return;
    }
    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

/** GET /api/periods/:id */
periodsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    const row = await db('periods').where('period_id', id).first();
    if (!row) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Period ${id} not found` } });
      return;
    }
    // Include staging count and trial balance for checklist display.
    const staging = await db('staging')
      .where('period_id', id)
      .where('status', 'PENDING')
      .count<[{ count: string }]>('staging_id as count')
      .first();
    const bal = await db('transaction_lines')
      .where('period_id', id)
      .select(
        db.raw('COALESCE(SUM(debit), 0) as total_debits'),
        db.raw('COALESCE(SUM(credit), 0) as total_credits'),
      )
      .first<{ total_debits: string; total_credits: string }>();

    res.json({
      success: true,
      data: {
        ...row,
        pending_staging_count: parseInt(staging?.count ?? '0', 10),
        total_debits: bal?.total_debits ?? '0',
        total_credits: bal?.total_credits ?? '0',
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/periods/:id/soft-close */
periodsRouter.post('/:id/soft-close', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    const today = (req.body as { today?: string }).today;
    const result = await softClosePeriod(id, today);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** POST /api/periods/:id/hard-close */
periodsRouter.post('/:id/hard-close', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    const closedBy =
      ((req.body as Record<string, string>)['closed_by']) ||
      (req.headers['x-user-id'] as string | undefined) ||
      'unknown';
    const result = await hardClosePeriod(id, {
      closedBy,
      chainWriter: makeChainWriter(),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

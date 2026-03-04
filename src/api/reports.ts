import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../db/connection';

// ---------------------------------------------------------------------------
// reports.ts — Trial balance and dashboard stats endpoints
// ---------------------------------------------------------------------------

export const reportsRouter = Router();

/** GET /api/reports/trial-balance?period_id= */
reportsRouter.get('/trial-balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period_id } = req.query as Record<string, string | undefined>;

    let linesQuery = db('transaction_lines')
      .join('accounts', 'transaction_lines.account_code', 'accounts.code')
      .select(
        'accounts.code',
        'accounts.name',
        'accounts.type',
        'accounts.category',
        db.raw('COALESCE(SUM(transaction_lines.debit), 0) as total_debits'),
        db.raw('COALESCE(SUM(transaction_lines.credit), 0) as total_credits'),
      )
      .groupBy('accounts.code', 'accounts.name', 'accounts.type', 'accounts.category')
      .orderBy('accounts.code');

    if (period_id) {
      linesQuery = linesQuery.where('transaction_lines.period_id', period_id);
    }

    const lines = await linesQuery;

    const totalDebits = lines.reduce(
      (sum: number, row: { total_debits: string }) => sum + parseFloat(row.total_debits),
      0,
    );
    const totalCredits = lines.reduce(
      (sum: number, row: { total_credits: string }) => sum + parseFloat(row.total_credits),
      0,
    );

    let period = null;
    if (period_id) {
      period = await db('periods').where('period_id', period_id).first();
    }

    res.json({
      success: true,
      data: {
        period,
        lines,
        total_debits: totalDebits.toFixed(2),
        total_credits: totalCredits.toFixed(2),
        balanced: Math.abs(totalDebits - totalCredits) < 0.005,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/dashboard */
reportsRouter.get('/dashboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Current open period
    const currentPeriod = await db('periods')
      .where('status', 'OPEN')
      .orderBy('period_id', 'desc')
      .first();

    // Pending approval count
    const pendingResult = await db('staging')
      .where('status', 'PENDING')
      .count<[{ count: string }]>('staging_id as count')
      .first();
    const pendingCount = parseInt(pendingResult?.count ?? '0', 10);

    // Recent transactions (last 10)
    const recentTransactions = await db('transactions')
      .orderBy('date', 'desc')
      .orderBy('transaction_id', 'desc')
      .limit(10);

    // Trial balance summary for current period
    let trialBalanceSummary: { total_debits: string; total_credits: string } = {
      total_debits: '0.00',
      total_credits: '0.00',
    };

    if (currentPeriod) {
      const bal = await db('transaction_lines')
        .where('period_id', currentPeriod.period_id)
        .select(
          db.raw('COALESCE(SUM(debit), 0) as total_debits'),
          db.raw('COALESCE(SUM(credit), 0) as total_credits'),
        )
        .first<{ total_debits: string; total_credits: string }>();

      if (bal) {
        trialBalanceSummary = bal;
      }
    }

    // Transaction counts per type for current period
    let transactionCounts: Array<{ transaction_type: string; count: string }> = [];
    if (currentPeriod) {
      transactionCounts = await db('transactions')
        .where('period_id', currentPeriod.period_id)
        .select('transaction_type')
        .count<Array<{ transaction_type: string; count: string }>>('transaction_id as count')
        .groupBy('transaction_type')
        .orderBy('count', 'desc');
    }

    res.json({
      success: true,
      data: {
        current_period: currentPeriod ?? null,
        pending_approval_count: pendingCount,
        recent_transactions: recentTransactions,
        trial_balance_summary: trialBalanceSummary,
        transaction_counts: transactionCounts,
      },
    });
  } catch (err) {
    next(err);
  }
});

import type { Request, Response, NextFunction } from "express";
import * as reportsEngine from "../engine/reports";

// ─── GET /reports/trial-balance ───────────────────────────────────────────────

export async function getTrialBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period, as_at_date } = req.query as Record<string, string | undefined>;
    const report = await reportsEngine.getTrialBalance({ period_id: period, as_at_date });
    res.json({ success: true, data: report });
  } catch (err) { next(err); }
}

// ─── GET /reports/profit-and-loss ─────────────────────────────────────────────

export async function getProfitAndLoss(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period, date_from, date_to } = req.query as Record<string, string | undefined>;
    const report = await reportsEngine.getProfitAndLoss({ period_id: period, date_from, date_to });
    res.json({ success: true, data: report });
  } catch (err) { next(err); }
}

// ─── GET /reports/balance-sheet ───────────────────────────────────────────────

export async function getBalanceSheet(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { as_at_date, period } = req.query as Record<string, string | undefined>;
    const report = await reportsEngine.getBalanceSheet({ as_at_date, period_id: period });
    res.json({ success: true, data: report });
  } catch (err) { next(err); }
}

// ─── GET /reports/cash-flow ────────────────────────────────────────────────────

export async function getCashFlow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period } = req.query as Record<string, string | undefined>;
    if (!period) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "period query parameter is required" },
      });
      return;
    }
    const report = await reportsEngine.getCashFlow({ period_id: period });
    res.json({ success: true, data: report });
  } catch (err) { next(err); }
}

import type { Request, Response, NextFunction } from "express";
import * as periodsDb from "../db/queries/periods";
import * as periodsEngine from "../engine/periods";

// ─── GET /periods ─────────────────────────────────────────────────────────────

export async function listPeriods(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const periods = await periodsDb.listPeriods();
    res.json({ success: true, data: periods });
  } catch (err) {
    next(err);
  }
}

// ─── GET /periods/current ─────────────────────────────────────────────────────

export async function getCurrentPeriod(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const period = await periodsDb.getCurrentPeriod();

    if (!period) {
      res.status(404).json({
        success: false,
        error: { code: "PERIOD_NOT_FOUND", message: "No open period found" },
      });
      return;
    }

    res.json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

// ─── GET /periods/:id/status ──────────────────────────────────────────────────

export async function getPeriodStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const period = await periodsDb.getPeriod(id);

    if (!period) {
      res.status(404).json({
        success: false,
        error: { code: "PERIOD_NOT_FOUND", message: `Period ${id} not found` },
      });
      return;
    }

    res.json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

// ─── POST /periods/:id/soft-close ─────────────────────────────────────────────

export async function softClosePeriod(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const period = await periodsEngine.softClosePeriod(id);
    res.json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

// ─── POST /periods/:id/close ──────────────────────────────────────────────────

export async function hardClosePeriod(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { closed_by } = req.body as { closed_by?: string };

    // Default to the authenticated user if closed_by not explicitly provided
    const closedBy = closed_by ?? req.userId;

    const period = await periodsEngine.hardClosePeriod(id, closedBy);
    res.json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

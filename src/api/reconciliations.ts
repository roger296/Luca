import type { Request, Response, NextFunction } from "express";
import { knex } from "../db/connection";

// ─── POST /reconciliations ─────────────────────────────────────────────────────

export async function createReconciliation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      period_id,
      module_id,
      control_account,
      module_balance,
      gl_balance,
      is_reconciled,
      notes,
    } = req.body as {
      period_id: string;
      module_id: string;
      control_account: string;
      module_balance: string | number;
      gl_balance: string | number;
      is_reconciled: boolean;
      notes?: string | null;
    };

    if (
      !period_id ||
      !module_id ||
      !control_account ||
      module_balance == null ||
      gl_balance == null ||
      is_reconciled == null
    ) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message:
            "period_id, module_id, control_account, module_balance, gl_balance, is_reconciled are required",
        },
      });
      return;
    }

    // Validate period exists and is OPEN or SOFT_CLOSE
    const period = await knex("periods")
      .where({ period_id })
      .first();
    if (!period) {
      res.status(404).json({
        success: false,
        error: { code: "PERIOD_NOT_FOUND", message: `Period ${period_id} not found` },
      });
      return;
    }
    const periodStatus = (period as Record<string, unknown>)["status"] as string;
    if (!["OPEN", "SOFT_CLOSE"].includes(periodStatus)) {
      res.status(422).json({
        success: false,
        error: {
          code: "INVALID_PERIOD_STATE",
          message: `Period ${period_id} must be OPEN or SOFT_CLOSE to submit reconciliation (current: ${periodStatus})`,
        },
      });
      return;
    }

    // Validate module is registered
    const module = await knex("registered_modules")
      .where({ module_id })
      .first();
    if (!module) {
      res.status(404).json({
        success: false,
        error: {
          code: "MODULE_NOT_FOUND",
          message: `Module ${module_id} is not registered`,
        },
      });
      return;
    }

    // Validate control account exists
    const account = await knex("accounts")
      .where({ code: control_account })
      .first();
    if (!account) {
      res.status(404).json({
        success: false,
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: `Account ${control_account} not found`,
        },
      });
      return;
    }

    const [row] = await knex("sub_ledger_reconciliations")
      .insert({
        period_id,
        module_id,
        control_account,
        module_balance,
        gl_balance,
        is_reconciled,
        notes: notes ?? null,
      })
      .returning("*");

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
}

// ─── GET /reconciliations?period=YYYY-MM ──────────────────────────────────────

export async function listReconciliations(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { period } = req.query as Record<string, string | undefined>;

    if (!period) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "period query parameter is required (YYYY-MM)",
        },
      });
      return;
    }

    const rows = await knex("sub_ledger_reconciliations")
      .where({ period_id: period })
      .orderBy("confirmed_at", "asc");

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

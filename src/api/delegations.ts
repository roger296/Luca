import type { Request, Response, NextFunction } from "express";
import {
  createDelegation,
  revokeDelegation,
  getActiveDelegations,
} from "../engine/approval";

/** POST /api/v1/gl/delegations — create a new delegation */
export async function createDelegationHandler(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const delegatorId = req.userId;
    const { delegate_id, valid_from, valid_until, scope } =
      req.body as Record<string, unknown>;

    if (!delegate_id || typeof delegate_id !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "delegate_id is required" },
      });
      return;
    }
    if (!valid_from || !valid_until) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "valid_from and valid_until are required" },
      });
      return;
    }

    const delegation = await createDelegation(
      delegatorId,
      String(delegate_id),
      String(valid_from),
      String(valid_until),
      scope as Parameters<typeof createDelegation>[4] ?? undefined
    );

    res.status(201).json({ success: true, data: delegation });
  } catch (err) { next(err); }
}

/** GET /api/v1/gl/delegations — list active delegations for this tenant */
export async function listDelegationsHandler(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { user_id } = req.query as { user_id?: string };
    const delegations = await getActiveDelegations(user_id);
    res.json({ success: true, data: delegations });
  } catch (err) { next(err); }
}

/** DELETE /api/v1/gl/delegations/:id — revoke a delegation */
export async function revokeDelegationHandler(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    await revokeDelegation(id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

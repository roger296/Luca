import type { Request, Response, NextFunction } from "express";
import * as modulesDb from "../db/queries/modules";

/** GET /api/v1/gl/modules — list registered modules for the tenant */
export async function listModules(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const modules = await modulesDb.listModules();
    res.json({ success: true, data: modules });
  } catch (err) { next(err); }
}

/** POST /api/v1/gl/modules — register (or update) a module */
export async function registerModule(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { module_id, display_name, public_key, allowed_transaction_types } =
      req.body as Record<string, unknown>;

    if (!module_id || typeof module_id !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "module_id is required" },
      });
      return;
    }
    if (!display_name || typeof display_name !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "display_name is required" },
      });
      return;
    }

    const module = await modulesDb.registerModule(
      module_id,
      display_name,
      typeof public_key === "string" ? public_key : null,
      Array.isArray(allowed_transaction_types) ? (allowed_transaction_types as string[]) : []
    );

    res.status(201).json({ success: true, data: module });
  } catch (err) { next(err); }
}

/** PUT /api/v1/gl/modules/:module_id/key — update the public key for a module */
export async function updateModuleKey(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    const { module_id } = req.params;
    const { public_key } = req.body as Record<string, string>;

    if (!public_key) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "public_key is required" },
      });
      return;
    }

    await modulesDb.updateModuleKey(module_id, public_key);
    res.json({ success: true });
  } catch (err) { next(err); }
}

import type { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";

/**
 * Create a validation middleware from a Zod schema.
 * Validates req.body and attaches the parsed data back to req.body.
 */
export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: formatted },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  return error.errors.map((e) => ({
    path: e.path.join("."),
    message: e.message,
  }));
}

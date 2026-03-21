import type { Request, Response, NextFunction } from "express";
import {
  ValidationError, AccountNotFoundError, DuplicateIdempotencyKeyError,
  PeriodClosedError, PeriodSoftClosedError, PeriodNotFoundError,
  InvalidPeriodStateError, PeriodSequenceError, StagingNotClearError,
  TrialBalanceError, InvalidModuleSignatureError, SegregationOfDutiesError,
  ExchangeRateRequiredError, ModuleNotAuthorisedError,
} from "../../engine/types";

/**
 * Central error handling middleware. Converts known domain errors to
 * appropriate HTTP responses with the standard error envelope.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: err.message } });
    return;
  }
  if (err instanceof AccountNotFoundError) {
    res.status(404).json({ success: false, error: { code: "ACCOUNT_NOT_FOUND", message: err.message } });
    return;
  }
  if (err instanceof DuplicateIdempotencyKeyError) {
    res.status(409).json({ success: false, error: { code: "DUPLICATE_IDEMPOTENCY_KEY", message: err.message } });
    return;
  }
  if (err instanceof PeriodClosedError) {
    res.status(422).json({ success: false, error: { code: "PERIOD_CLOSED", message: err.message } });
    return;
  }
  if (err instanceof PeriodSoftClosedError) {
    res.status(422).json({ success: false, error: { code: "PERIOD_SOFT_CLOSED", message: err.message } });
    return;
  }
  if (err instanceof PeriodNotFoundError) {
    res.status(404).json({ success: false, error: { code: "PERIOD_NOT_FOUND", message: err.message } });
    return;
  }
  if (err instanceof InvalidPeriodStateError || err instanceof PeriodSequenceError) {
    res.status(422).json({ success: false, error: { code: "INVALID_PERIOD_STATE", message: err.message } });
    return;
  }
  if (err instanceof StagingNotClearError) {
    res.status(422).json({ success: false, error: { code: "STAGING_NOT_CLEAR", message: err.message } });
    return;
  }
  if (err instanceof TrialBalanceError) {
    res.status(422).json({ success: false, error: { code: "TRIAL_BALANCE_UNBALANCED", message: err.message } });
    return;
  }
  if (err instanceof InvalidModuleSignatureError) {
    res.status(403).json({ success: false, error: { code: "INVALID_MODULE_SIGNATURE", message: err.message } });
    return;
  }
  if (err instanceof SegregationOfDutiesError) {
    res.status(403).json({ success: false, error: { code: "SEGREGATION_OF_DUTIES_VIOLATION", message: err.message } });
    return;
  }
  if (err instanceof ExchangeRateRequiredError) {
    res.status(400).json({ success: false, error: { code: "EXCHANGE_RATE_REQUIRED", message: err.message } });
    return;
  }
  if (err instanceof ModuleNotAuthorisedError) {
    res.status(403).json({ success: false, error: { code: "MODULE_NOT_AUTHORISED", message: err.message } });
    return;
  }

  // Unknown error — log and return 500
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "An internal error occurred" } });
}

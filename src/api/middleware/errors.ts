import type { NextFunction, Request, Response } from 'express';
import { PeriodClosedError, PeriodSoftClosedError } from '../../chain/types';
import {
  InvalidPeriodStateError,
  PeriodNotFoundError,
  PeriodNotEndedError,
  PeriodSequenceError,
  StagingNotClearError,
  TrialBalanceError,
} from '../../engine/periods';
import { PostingEngineError, ValidationError } from '../../engine/types';

// ---------------------------------------------------------------------------
// errors.ts — Express error-handling middleware
// ---------------------------------------------------------------------------

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ValidationError) {
    res
      .status(400)
      .json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } });
    return;
  }

  if (err instanceof PostingEngineError) {
    res
      .status(400)
      .json({ success: false, error: { code: 'POSTING_ERROR', message: err.message } });
    return;
  }

  if (err instanceof PeriodNotFoundError) {
    res
      .status(404)
      .json({ success: false, error: { code: 'PERIOD_NOT_FOUND', message: err.message } });
    return;
  }

  if (err instanceof PeriodClosedError) {
    res
      .status(409)
      .json({ success: false, error: { code: 'PERIOD_CLOSED', message: err.message } });
    return;
  }

  if (err instanceof PeriodSoftClosedError) {
    res
      .status(409)
      .json({ success: false, error: { code: 'PERIOD_SOFT_CLOSED', message: err.message } });
    return;
  }

  if (err instanceof InvalidPeriodStateError || err instanceof PeriodNotEndedError) {
    res
      .status(409)
      .json({ success: false, error: { code: 'INVALID_PERIOD_STATE', message: err.message } });
    return;
  }

  if (err instanceof PeriodSequenceError) {
    res
      .status(409)
      .json({ success: false, error: { code: 'PERIOD_SEQUENCE_ERROR', message: err.message } });
    return;
  }

  if (err instanceof StagingNotClearError) {
    res
      .status(409)
      .json({ success: false, error: { code: 'STAGING_NOT_CLEAR', message: err.message } });
    return;
  }

  if (err instanceof TrialBalanceError) {
    res
      .status(409)
      .json({ success: false, error: { code: 'TRIAL_BALANCE_ERROR', message: err.message } });
    return;
  }

  // Unknown error — log and return 500.
  console.error('Unhandled error:', err);
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
}

import type { Request, Response, NextFunction } from "express";
import * as chainReader from "../chain/reader";
import * as transactionsDb from "../db/queries/transactions";

// ─── GET /chain/verify?period=YYYY-MM ─────────────────────────────────────────

export async function verifyChain(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { period } = req.query as Record<string, string | undefined>;

    if (!period) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "period query parameter is required (YYYY-MM)" },
      });
      return;
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "period must be in YYYY-MM format" },
      });
      return;
    }

    const result = chainReader.verifyChain(period);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ─── GET /chain/checkpoint/:period ────────────────────────────────────────────

export async function getCheckpoint(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { period } = req.params;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "period must be in YYYY-MM format" },
      });
      return;
    }

    const checkpoint = chainReader.getCheckpoint(period);

    if (!checkpoint) {
      res.status(404).json({
        success: false,
        error: {
          code: "CHECKPOINT_NOT_FOUND",
          message: `No closed period checkpoint found for ${period}`,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        period_id: period,
        closing_hash: checkpoint.closing_hash,
        merkle_root: checkpoint.merkle_root,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /chain/proof/:transaction_id ─────────────────────────────────────────

export async function getMerkleProof(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { transaction_id } = req.params;

    // Look up the transaction to find its period_id and chain_sequence
    const transaction = await transactionsDb.getTransaction(transaction_id);

    if (!transaction) {
      res.status(404).json({
        success: false,
        error: {
          code: "TRANSACTION_NOT_FOUND",
          message: `Transaction ${transaction_id} not found`,
        },
      });
      return;
    }

    if (!transaction.chain_sequence) {
      res.status(422).json({
        success: false,
        error: {
          code: "CHAIN_SEQUENCE_MISSING",
          message: `Transaction ${transaction_id} has no chain sequence — it may not be committed`,
        },
      });
      return;
    }

    const proof = chainReader.getMerkleProof(
      transaction.period_id,
      transaction.chain_sequence
    );

    res.json({
      success: true,
      data: {
        transaction_id,
        period_id: transaction.period_id,
        chain_sequence: transaction.chain_sequence,
        proof,
      },
    });
  } catch (err) {
    next(err);
  }
}

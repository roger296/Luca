import type { Request, Response, NextFunction } from "express";
import * as approvalsDb from "../db/queries/approvals";
import * as approvalEngine from "../engine/approval";
import { commitTransaction } from "../engine/posting";

// ─── GET /approvals/pending ───────────────────────────────────────────────────

export async function listPendingApprovals(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { transaction_type, amount_min, amount_max, source_module, sort_by } =
      req.query as Record<string, string | undefined>;

    const entries = await approvalsDb.listPendingApprovals({
      transaction_type,
      amount_min,
      amount_max,
      source_module,
      sort_by,
    });

    res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
}

// ─── GET /approvals/:staging_id ───────────────────────────────────────────────

export async function getApprovalItem(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { staging_id } = req.params;
    const entry = await approvalsDb.getStagingEntry(staging_id);

    if (!entry) {
      res.status(404).json({
        success: false,
        error: { code: "STAGING_NOT_FOUND", message: `Staging entry ${staging_id} not found` },
      });
      return;
    }

    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

// ─── POST /approvals/:staging_id/approve ─────────────────────────────────────

export async function approveTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { staging_id } = req.params;
    const { notes } = req.body as { notes?: string };

    const { approved, fullyApproved, stagingEntry } = await approvalEngine.processApproval(
      staging_id,
      "approve",
      req.userId,
      notes
    );

    if (!approved) {
      // Should not occur for "approve" action, but guard anyway
      res.status(422).json({
        success: false,
        error: { code: "APPROVAL_FAILED", message: "Approval could not be processed" },
      });
      return;
    }

    if (fullyApproved) {
      // Fully approved — commit to chain
      const submission = stagingEntry.payload;
      const periodId = stagingEntry.period_id;

      const postingResult = await commitTransaction(
        submission,
        periodId
      );

      res.json({
        success: true,
        data: {
          staging_id,
          ...postingResult,
        },
      });
      return;
    }

    // Partially approved — still needs more approvals
    const approvals = stagingEntry.approvals ?? [];
    const ruleRow = await approvalsDb.getApprovalRules(
      stagingEntry.transaction_type
    );
    const requiredApprovals = ruleRow.length > 0 ? (ruleRow[0]?.required_approvals ?? 1) : 1;

    res.json({
      success: true,
      data: {
        status: "PARTIALLY_APPROVED",
        staging_id,
        approvals_count: approvals.length,
        required_approvals: requiredApprovals,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /approvals/:staging_id/reject ───────────────────────────────────────

export async function rejectTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { staging_id } = req.params;
    const { reason } = req.body as { reason: string };

    if (!reason) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "reason is required for rejection" },
      });
      return;
    }

    const { stagingEntry } = await approvalEngine.processApproval(
      staging_id,
      "reject",
      req.userId,
      undefined,
      reason
    );

    res.json({
      success: true,
      data: {
        status: "REJECTED",
        staging_id,
        rejected_by: stagingEntry.rejected_by,
        rejected_at: stagingEntry.rejected_at,
        rejection_reason: stagingEntry.rejection_reason,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /approvals/bulk-approve ─────────────────────────────────────────────

export async function bulkApprove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { staging_ids, notes } = req.body as { staging_ids: string[]; notes?: string };

    if (!Array.isArray(staging_ids) || staging_ids.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "staging_ids must be a non-empty array" },
      });
      return;
    }

    const results: Array<{
      staging_id: string;
      status: string;
      transaction_id?: string;
      chain_hash?: string;
      error_code?: string;
      message?: string;
    }> = [];

    for (const stagingId of staging_ids) {
      try {
        const { approved, fullyApproved, stagingEntry } = await approvalEngine.processApproval(
          stagingId,
          "approve",
          req.userId,
          notes
        );

        if (!approved) {
          results.push({ staging_id: stagingId, status: "FAILED", error_code: "APPROVAL_FAILED" });
          continue;
        }

        if (fullyApproved) {
          const submission = stagingEntry.payload;
          const periodId = stagingEntry.period_id;
          const postingResult = await commitTransaction(submission, periodId);
          results.push({
            staging_id: stagingId,
            status: "POSTED",
            transaction_id: postingResult.transaction_id,
            chain_hash: postingResult.chain_hash,
          });
        } else {
          const approvals = stagingEntry.approvals ?? [];
          results.push({
            staging_id: stagingId,
            status: "PARTIALLY_APPROVED",
            message: `${approvals.length} approval(s) recorded`,
          });
        }
      } catch (itemErr: unknown) {
        const errorCode =
          itemErr instanceof Error ? itemErr.constructor.name : "UNKNOWN_ERROR";
        const message =
          itemErr instanceof Error ? itemErr.message : "An unknown error occurred";
        results.push({ staging_id: stagingId, status: "FAILED", error_code: errorCode, message });
      }
    }

    const posted = results.filter((r) => r.status === "POSTED").length;
    const partiallyApproved = results.filter((r) => r.status === "PARTIALLY_APPROVED").length;
    const failed = results.filter((r) => r.status === "FAILED").length;

    res.json({
      success: true,
      data: {
        results,
        summary: {
          total: staging_ids.length,
          posted,
          partially_approved: partiallyApproved,
          failed,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

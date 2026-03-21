import Decimal from "decimal.js";
import { knex } from "../db/connection";
import { publishEvent } from "./webhooks";
import type {
  TransactionSubmission,
  PostingResult,
  StagingEntry,
  ApprovalRule,
  ApprovalDelegation,
} from "./types";
import { SegregationOfDutiesError, ValidationError } from "./types";

// ─── Effective approvers (delegation-aware) ──────────────────────────────────

export async function getEffectiveApprovers(
  userId: string,
  transactionType: string,
  grossAmount: string,
  now: string
): Promise<string[]> {
  const delegations = await knex("approval_delegations")
    .where("delegate_id", userId)
    .where("valid_from", "<=", now)
    .where("valid_until", ">=", now)
    .select("delegator_id", "scope");

  const effectiveDelegators: string[] = [];
  for (const d of delegations as Array<{ delegator_id: string; scope: unknown }>) {
    const scope = d.scope
      ? typeof d.scope === "string"
        ? (JSON.parse(d.scope as string) as ApprovalDelegation["scope"])
        : (d.scope as ApprovalDelegation["scope"])
      : null;

    if (scope) {
      if (
        Array.isArray(scope.transaction_types) &&
        scope.transaction_types.length > 0 &&
        !scope.transaction_types.includes(transactionType)
      ) {
        continue;
      }
      if (scope.max_amount && new Decimal(grossAmount).gt(new Decimal(scope.max_amount))) {
        continue;
      }
    }
    effectiveDelegators.push(d.delegator_id);
  }
  return [userId, ...effectiveDelegators];
}

// ─── Delegation CRUD ─────────────────────────────────────────────────────────

export async function createDelegation(
  delegatorId: string,
  delegateId: string,
  validFrom: string,
  validUntil: string,
  scope?: ApprovalDelegation["scope"]
): Promise<ApprovalDelegation> {
  const [row] = await knex("approval_delegations")
    .insert({
      delegator_id: delegatorId,
      delegate_id: delegateId,
      valid_from: validFrom,
      valid_until: validUntil,
      scope: scope ? JSON.stringify(scope) : null,
    })
    .returning("*");
  return row as ApprovalDelegation;
}

export async function revokeDelegation(delegationId: string): Promise<void> {
  await knex("approval_delegations")
    .where({ id: delegationId })
    .delete();
}

export async function getActiveDelegations(userId?: string): Promise<ApprovalDelegation[]> {
  const now = new Date().toISOString();
  const query = knex("approval_delegations")
    .where("valid_from", "<=", now)
    .where("valid_until", ">=", now);
  if (userId) {
    query.where(function () {
      this.where("delegator_id", userId).orWhere("delegate_id", userId);
    });
  }
  const rows = await query.orderBy("created_at", "desc");
  return rows as ApprovalDelegation[];
}

// ─── Approval requirement evaluation ────────────────────────────────────────

export async function evaluateApprovalRequirement(
  transactionType: string,
  grossAmount: string
): Promise<{
  autoApprove: boolean;
  rule: ApprovalRule | null;
  requiredRole: string | null;
}> {
  const rows = await knex("approval_rules")
    .where("is_active", true)
    .where(function () {
      this.where("transaction_type", transactionType).orWhereNull("transaction_type");
    })
    .orderByRaw("CASE WHEN transaction_type IS NOT NULL THEN 0 ELSE 1 END ASC")
    .select("*");

  if (!rows || rows.length === 0) {
    return { autoApprove: true, rule: null, requiredRole: null };
  }

  const rule = rows[0] as ApprovalRule;
  const amount = new Decimal(grossAmount);

  if (rule.auto_approve_below !== null) {
    const threshold = new Decimal(rule.auto_approve_below);
    if (amount.lt(threshold)) {
      return { autoApprove: true, rule, requiredRole: null };
    }
  }
  return { autoApprove: false, rule, requiredRole: rule.required_approver_role };
}

export async function stageTransaction(
  submission: TransactionSubmission,
  grossAmount: string,
  periodId: string,
  rule: ApprovalRule | null
): Promise<PostingResult> {
  const submittedBy = submission.approval_context?.submitted_by ?? null;
  const requiredApprover = submission.approval_context?.required_approver ?? null;
  const requiredApproverRole =
    submission.approval_context?.required_approver_role ??
    rule?.required_approver_role ??
    null;

  const [row] = await knex("staging")
    .insert({
      transaction_type: submission.transaction_type,
      reference: submission.reference ?? null,
      date: submission.date,
      period_id: periodId,
      currency: submission.currency ?? "GBP",
      exchange_rate: submission.exchange_rate ?? null,
      payload: JSON.stringify(submission),
      status: "PENDING",
      submitted_by: submittedBy,
      required_approver: requiredApprover,
      required_approver_role: requiredApproverRole,
      approvals: JSON.stringify([]),
      idempotency_key: submission.idempotency_key ?? null,
      gross_amount: grossAmount,
    })
    .returning("staging_id");

  const stagingId = (row as Record<string, unknown>)["staging_id"] as string;
  return {
    status: "AWAITING_APPROVAL",
    staging_id: stagingId,
    message: "Transaction staged for approval. Required role: " + (requiredApproverRole ?? "any"),
  };
}

// ─── Core approval processing ────────────────────────────────────────────────

export async function processApproval(
  stagingId: string,
  action: "approve" | "reject",
  actorUserId: string,
  notes?: string,
  rejectionReason?: string
): Promise<{ approved: boolean; fullyApproved: boolean; stagingEntry: StagingEntry }> {
  const row = await knex("staging")
    .where({ staging_id: stagingId })
    .first();

  if (!row) throw new Error("Staging entry " + stagingId + " not found");

  const stagingEntry = rowToStagingEntry(row as Record<string, unknown>);

  if (action === "reject") {
    await knex("staging")
      .where({ staging_id: stagingId })
      .update({
        status: "REJECTED",
        rejected_by: actorUserId,
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectionReason ?? null,
      });
    stagingEntry.status = "REJECTED";
    stagingEntry.rejected_by = actorUserId;
    stagingEntry.rejection_reason = rejectionReason ?? null;
    publishEvent("TRANSACTION_REJECTED", {
      staging_id: stagingId,
      rejected_by: actorUserId,
      reason: rejectionReason ?? null,
      transaction_type: stagingEntry.transaction_type,
    });
    return { approved: false, fullyApproved: false, stagingEntry };
  }

  // ── Segregation of duties check ──────────────────────────────────────
  await checkSegregationOfDuties(stagingEntry, actorUserId);

  // ── Delegation-aware effective approvers ─────────────────────────────
  const now = new Date().toISOString();
  const grossAmount = stagingEntry.gross_amount ?? "0";
  const effectiveApprovers = await getEffectiveApprovers(
    actorUserId, stagingEntry.transaction_type, grossAmount, now
  );

  // ── Required-approver authority check ────────────────────────────────
  if (
    stagingEntry.required_approver &&
    !effectiveApprovers.includes(stagingEntry.required_approver)
  ) {
    throw new ValidationError(
      "Approval not authorised: requires authority of " + stagingEntry.required_approver
    );
  }

  // ── Duplicate approval check ─────────────────────────────────────────
  const existingApprovals: Array<{ approved_by: string }> = stagingEntry.approvals ?? [];
  if (existingApprovals.some((a) => a.approved_by === actorUserId)) {
    throw new ValidationError("User " + actorUserId + " has already approved this transaction");
  }

  // ── Record the approval ──────────────────────────────────────────────
  const newApproval = {
    approved_by: actorUserId,
    approved_at: new Date().toISOString(),
    notes: notes ?? null,
  };
  const updatedApprovals = [...existingApprovals, newApproval];

  // ── Determine if fully approved ──────────────────────────────────────
  const ruleRow = await knex("approval_rules")
    .where("is_active", true)
    .where(function () {
      this.where("transaction_type", stagingEntry.transaction_type).orWhereNull("transaction_type");
    })
    .orderByRaw("CASE WHEN transaction_type IS NOT NULL THEN 0 ELSE 1 END ASC")
    .first();

  const requiredApprovals: number = ruleRow
    ? ((ruleRow as Record<string, unknown>)["required_approvals"] as number)
    : 1;
  const fullyApproved = updatedApprovals.length >= requiredApprovals;

  const newStatus = fullyApproved ? "APPROVED" : "PARTIALLY_APPROVED";
  const updateData: Record<string, unknown> = {
    approvals: JSON.stringify(updatedApprovals),
    status: newStatus,
  };
  if (fullyApproved) {
    updateData["approved_by"] = actorUserId;
    updateData["approved_at"] = new Date().toISOString();
  }

  await knex("staging").where({ staging_id: stagingId }).update(updateData);

  stagingEntry.approvals = updatedApprovals as StagingEntry["approvals"];
  stagingEntry.status = newStatus as StagingEntry["status"];
  if (fullyApproved) {
    stagingEntry.approved_by = actorUserId;
    stagingEntry.approved_at = new Date().toISOString();
    publishEvent("TRANSACTION_APPROVED", {
      staging_id: stagingId,
      approved_by: actorUserId,
      transaction_type: stagingEntry.transaction_type,
    });
  }

  return { approved: true, fullyApproved, stagingEntry };
}

// ─── Segregation of Duties ────────────────────────────────────────────────────

export async function checkSegregationOfDuties(
  stagingEntry: StagingEntry,
  actorUserId: string
): Promise<void> {
  if (stagingEntry.submitted_by && stagingEntry.submitted_by === actorUserId) {
    throw new SegregationOfDutiesError(actorUserId, stagingEntry.staging_id);
  }

  const correlationId: string | undefined = stagingEntry.payload?.source?.correlation_id;
  if (!correlationId) return;

  const relatedTx = await knex("transactions")
    .where("correlation_id", correlationId)
    .select("transaction_id", "submitted_by")
    .first();

  if (
    relatedTx &&
    (relatedTx as Record<string, unknown>)["submitted_by"] === actorUserId
  ) {
    throw new SegregationOfDutiesError(
      actorUserId,
      (relatedTx as Record<string, unknown>)["transaction_id"] as string
    );
  }

  const relatedStaging = await knex("staging")
    .where("submitted_by", actorUserId)
    .whereNot("staging_id", stagingEntry.staging_id)
    .whereRaw("payload #>> '{source,correlation_id}' = ?", [correlationId])
    .select("staging_id")
    .first();

  if (relatedStaging) {
    throw new SegregationOfDutiesError(
      actorUserId,
      (relatedStaging as Record<string, unknown>)["staging_id"] as string
    );
  }
}

// ─── Escalation ───────────────────────────────────────────────────────────────

export async function escalateOverdueApprovals(thresholdHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000).toISOString();
  const overdueRows = await knex("staging")
    .whereIn("status", ["PENDING", "PARTIALLY_APPROVED"])
    .where("created_at", "<", cutoff)
    .select("*");

  let escalated = 0;
  for (const rawRow of overdueRows) {
    const entry = rowToStagingEntry(rawRow as Record<string, unknown>);
    let escalationTarget: string | null = null;

    if (entry.required_approver) {
      const delegation = await knex("approval_delegations")
        .where("delegate_id", entry.required_approver)
        .where("valid_until", ">=", new Date().toISOString())
        .select("delegator_id")
        .first();
      if (delegation) {
        escalationTarget = (delegation as Record<string, unknown>)["delegator_id"] as string;
      }
    }

    const updateData: Record<string, unknown> = { status: "ESCALATED" };
    if (escalationTarget) updateData["required_approver"] = escalationTarget;
    await knex("staging")
      .where({ staging_id: entry.staging_id })
      .update(updateData);
    publishEvent("APPROVAL_ESCALATED", {
      staging_id: entry.staging_id,
      escalated_to: escalationTarget ?? null,
      transaction_type: entry.transaction_type,
    });
    escalated++;
  }
  return escalated;
}

// ─── Row mapping helper ───────────────────────────────────────────────────────

function rowToStagingEntry(row: Record<string, unknown>): StagingEntry {
  return {
    staging_id: row["staging_id"] as string,
    transaction_type: row["transaction_type"] as string,
    reference: row["reference"] as string | null,
    date: row["date"] as string,
    period_id: row["period_id"] as string,
    currency: row["currency"] as string,
    exchange_rate: row["exchange_rate"] as string | null,
    payload:
      typeof row["payload"] === "string"
        ? (JSON.parse(row["payload"] as string) as TransactionSubmission)
        : (row["payload"] as TransactionSubmission),
    status: row["status"] as StagingEntry["status"],
    submitted_by: row["submitted_by"] as string | null,
    required_approver: row["required_approver"] as string | null,
    required_approver_role: row["required_approver_role"] as string | null,
    approved_by: row["approved_by"] as string | null,
    approved_at: row["approved_at"] as string | null,
    rejected_by: row["rejected_by"] as string | null,
    rejected_at: row["rejected_at"] as string | null,
    rejection_reason: row["rejection_reason"] as string | null,
    approvals:
      typeof row["approvals"] === "string"
        ? (JSON.parse(row["approvals"] as string) as StagingEntry["approvals"])
        : ((row["approvals"] as StagingEntry["approvals"]) ?? []),
    gross_amount: row["gross_amount"] != null ? String(row["gross_amount"]) : null,
    idempotency_key: row["idempotency_key"] as string | null,
    created_at: row["created_at"] as string,
  };
}

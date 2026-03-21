import { knex } from "../connection";
import type { StagingEntry, ApprovalRule } from "../../engine/types";

export async function insertStaging(
  data: {
    transaction_type: string;
    reference?: string;
    date: string;
    period_id: string;
    currency: string;
    exchange_rate?: string;
    payload: object;
    submitted_by?: string;
    required_approver?: string;
    required_approver_role?: string;
    idempotency_key?: string;
  }
): Promise<StagingEntry> {
  const [row] = await knex("staging")
    .insert({
      ...data,
      status: "PENDING",
      approvals: JSON.stringify([]),
    })
    .returning("*");
  return row as StagingEntry;
}

export async function getStagingEntry(
  stagingId: string
): Promise<StagingEntry | null> {
  const row = await knex("staging")
    .where({ staging_id: stagingId })
    .first();
  return row ? (row as StagingEntry) : null;
}

export async function listPendingApprovals(
  filters?: {
    transaction_type?: string;
    amount_min?: string;
    amount_max?: string;
    source_module?: string;
    sort_by?: string;
  }
): Promise<StagingEntry[]> {
  const query = knex("staging")
    .whereIn("status", ["PENDING", "PARTIALLY_APPROVED"]);

  if (filters?.transaction_type) {
    query.where("transaction_type", filters.transaction_type);
  }

  if (filters?.source_module) {
    query.whereRaw("payload->'source'->>'module_id' = ?", [filters.source_module]);
  }

  if (filters?.amount_min) {
    query.whereRaw(
      "(payload->>'gross_amount')::numeric >= ?",
      [filters.amount_min]
    );
  }

  if (filters?.amount_max) {
    query.whereRaw(
      "(payload->>'gross_amount')::numeric <= ?",
      [filters.amount_max]
    );
  }

  const allowedSort: Record<string, string> = {
    created_at: "created_at",
    date: "date",
    transaction_type: "transaction_type",
  };
  const sortCol = allowedSort[filters?.sort_by ?? ""] ?? "created_at";
  query.orderBy(sortCol, "asc");

  const rows = await query;
  return rows as StagingEntry[];
}

export async function updateStagingStatus(
  stagingId: string,
  status: string,
  data: {
    approved_by?: string;
    approved_at?: string;
    rejected_by?: string;
    rejected_at?: string;
    rejection_reason?: string;
    approvals?: object[];
  }
): Promise<void> {
  const update: Record<string, unknown> = { status };

  if (data.approved_by !== undefined) update.approved_by = data.approved_by;
  if (data.approved_at !== undefined) update.approved_at = data.approved_at;
  if (data.rejected_by !== undefined) update.rejected_by = data.rejected_by;
  if (data.rejected_at !== undefined) update.rejected_at = data.rejected_at;
  if (data.rejection_reason !== undefined) update.rejection_reason = data.rejection_reason;
  if (data.approvals !== undefined) update.approvals = JSON.stringify(data.approvals);

  await knex("staging")
    .where({ staging_id: stagingId })
    .update(update);
}

export async function getApprovalRules(
  transactionType: string
): Promise<ApprovalRule[]> {
  const rows = await knex("approval_rules")
    .where("is_active", true)
    .where((builder) => {
      builder
        .where("transaction_type", transactionType)
        .orWhereNull("transaction_type");
    })
    .orderByRaw("transaction_type NULLS LAST");

  return rows as ApprovalRule[];
}

export async function countPendingStaging(
  periodId?: string
): Promise<number> {
  const query = knex("staging")
    .where("status", "PENDING");

  if (periodId) {
    query.where("period_id", periodId);
  }

  const result = await query.count<{ count: string }[]>("staging_id as count").first();
  return parseInt((result as { count: string } | undefined)?.count ?? "0", 10);
}

export async function getEscalationCandidates(
  olderThanHours: number
): Promise<StagingEntry[]> {
  const rows = await knex("staging")
    .where("status", "PENDING")
    .whereRaw(
      "created_at < NOW() - (? * INTERVAL '1 hour')",
      [olderThanHours]
    )
    .orderBy("created_at", "asc");

  return rows as StagingEntry[];
}

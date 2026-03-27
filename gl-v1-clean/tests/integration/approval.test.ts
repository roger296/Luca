import { knex } from "../../src/db/connection";
import { setupTestTenant, cleanupTestTenant, closeKnex } from "./helpers";
import {
  processApproval,
  createDelegation,
  escalateOverdueApprovals,
} from "../../src/engine/approval";
import { ValidationError, SegregationOfDutiesError } from "../../src/engine/types";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeStagingPayload(transactionType: string, correlationId?: string | null) {
  return {
    transaction_type: transactionType,
    date: "2026-03-10",
    lines: [],
    source: {
      module_id: "test-module",
      module_reference: null,
      correlation_id: correlationId ?? null,
    },
  };
}

async function insertStaging(overrides: Record<string, unknown> = {}): Promise<string> {
  const txType = (overrides["transaction_type"] as string) ?? "MANUAL_JOURNAL";
  const defaults: Record<string, unknown> = {
    transaction_type: txType,
    date: "2026-03-10",
    period_id: "2026-03",
    currency: "GBP",
    exchange_rate: null,
    payload: JSON.stringify(makeStagingPayload(txType)),
    status: "PENDING",
    submitted_by: null,
    required_approver: null,
    required_approver_role: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    approvals: JSON.stringify([]),
    idempotency_key: null,
    gross_amount: "1000.00",
  };
  const [row] = await knex("staging")
    .insert({ ...defaults, ...overrides })
    .returning("staging_id");
  return (row as Record<string, unknown>)["staging_id"] as string;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(setupTestTenant);
afterEach(cleanupTestTenant);
afterAll(closeKnex);

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Approval workflow — delegation", () => {
  it("allows a delegate to approve when the delegator's authority is required", async () => {
    await createDelegation(
      "alice@example.com",
      "bob@example.com",
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
    );

    const stagingId = await insertStaging({ required_approver: "alice@example.com" });
    const result = await processApproval(stagingId, "approve", "bob@example.com");

    expect(result.approved).toBe(true);
    expect(result.fullyApproved).toBe(true);
    expect(result.stagingEntry.status).toBe("APPROVED");
  });

  it("rejects approval when the delegation has expired", async () => {
    await createDelegation(
      "alice@example.com",
      "bob@example.com",
      new Date(Date.now() - 7_200_000).toISOString(),
      new Date(Date.now() - 3_600_000).toISOString(),
    );

    const stagingId = await insertStaging({ required_approver: "alice@example.com" });
    await expect(
      processApproval(stagingId, "approve", "bob@example.com"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects approval when the delegation scope excludes the transaction type", async () => {
    await createDelegation(
      "alice@example.com",
      "bob@example.com",
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
      { transaction_types: ["MANUAL_JOURNAL"] },
    );

    const stagingId = await insertStaging({
      transaction_type: "SUPPLIER_INVOICE",
      payload: JSON.stringify(makeStagingPayload("SUPPLIER_INVOICE")),
      required_approver: "alice@example.com",
    });

    await expect(
      processApproval(stagingId, "approve", "bob@example.com"),
    ).rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-LEVEL APPROVAL
// ─────────────────────────────────────────────────────────────────────────────

describe("Approval workflow — multi-level", () => {
  beforeEach(async () => {
    await knex("approval_rules").insert({
      transaction_type: "SUPPLIER_INVOICE",
      auto_approve_below: null,
      required_approver_role: null,
      approval_roles: [],
      required_approvals: 2,
      is_active: true,
    });
  });

  afterEach(async () => {
    await knex("approval_rules")
      .where({ transaction_type: "SUPPLIER_INVOICE" })
      .delete();
  });

  it("transitions to PARTIALLY_APPROVED then APPROVED for a two-approval rule", async () => {
    const stagingId = await insertStaging({
      transaction_type: "SUPPLIER_INVOICE",
      payload: JSON.stringify(makeStagingPayload("SUPPLIER_INVOICE")),
    });

    const result1 = await processApproval(stagingId, "approve", "userA@example.com");
    expect(result1.fullyApproved).toBe(false);
    expect(result1.stagingEntry.status).toBe("PARTIALLY_APPROVED");

    const result2 = await processApproval(stagingId, "approve", "userB@example.com");
    expect(result2.fullyApproved).toBe(true);
    expect(result2.stagingEntry.status).toBe("APPROVED");
  });

  it("rejects a second approval attempt by the same user", async () => {
    const stagingId = await insertStaging({
      transaction_type: "SUPPLIER_INVOICE",
      payload: JSON.stringify(makeStagingPayload("SUPPLIER_INVOICE")),
    });

    await processApproval(stagingId, "approve", "userA@example.com");

    await expect(
      processApproval(stagingId, "approve", "userA@example.com"),
    ).rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESCALATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Approval workflow — escalation", () => {
  it("escalates PENDING entries that exceed the age threshold", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const stagingId = await insertStaging({ status: "PENDING" });
    await knex("staging")
      .where({ staging_id: stagingId })
      .update({ created_at: threeDaysAgo });

    const count = await escalateOverdueApprovals(48);
    expect(count).toBeGreaterThanOrEqual(1);

    const row = await knex("staging").where({ staging_id: stagingId }).first();
    expect((row as Record<string, unknown>)["status"]).toBe("ESCALATED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEGREGATION OF DUTIES
// ─────────────────────────────────────────────────────────────────────────────

describe("Approval workflow — segregation of duties", () => {
  it("rejects approval by the user who submitted a transaction with the same correlation_id", async () => {
    const correlationId = "saga-sod-test-001";

    await insertStaging({
      transaction_type: "SUPPLIER_INVOICE",
      submitted_by: "userA@example.com",
      payload: JSON.stringify(makeStagingPayload("SUPPLIER_INVOICE", correlationId)),
    });

    const paymentId = await insertStaging({
      transaction_type: "SUPPLIER_PAYMENT",
      submitted_by: null,
      payload: JSON.stringify(makeStagingPayload("SUPPLIER_PAYMENT", correlationId)),
    });

    await expect(
      processApproval(paymentId, "approve", "userA@example.com"),
    ).rejects.toThrow(SegregationOfDutiesError);
  });

  it("allows approval by a different user even with the same correlation_id", async () => {
    const correlationId = "saga-sod-test-002";

    await insertStaging({
      transaction_type: "SUPPLIER_INVOICE",
      submitted_by: "userA@example.com",
      payload: JSON.stringify(makeStagingPayload("SUPPLIER_INVOICE", correlationId)),
    });

    const paymentId = await insertStaging({
      transaction_type: "SUPPLIER_PAYMENT",
      submitted_by: null,
      payload: JSON.stringify(makeStagingPayload("SUPPLIER_PAYMENT", correlationId)),
    });

    const result = await processApproval(paymentId, "approve", "userB@example.com");
    expect(result.approved).toBe(true);
    expect(result.fullyApproved).toBe(true);
    expect(result.stagingEntry.status).toBe("APPROVED");
  });
});

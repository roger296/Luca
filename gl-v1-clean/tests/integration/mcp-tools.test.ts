// tests/integration/mcp-tools.test.ts
// Integration tests for MCP tool handlers.
// Calls handler functions directly (not via stdio transport).

import {
  handlePostTransaction,
  handleQueryJournal,
  handleGetTrialBalance,
  handleListAccounts,
  handleApproveTransaction,
  handleVerifyChain,
} from "../../src/mcp/tools";
import type { McpContext } from "../../src/mcp/auth";
import { setupTestTenant, cleanupTestTenant, closeKnex } from "./helpers";
import * as fs from "fs";
import * as path from "path";

const context: McpContext = {
  userId: "mcp-test@example.com",
  sourceModule: "mcp-agent",
};

function cleanChainFiles() {
  const chainsDir = path.join(process.cwd(), "chains");
  if (fs.existsSync(chainsDir)) {
    for (const f of fs.readdirSync(chainsDir)) {
      if (!f.endsWith(".chain.jsonl")) continue;
      const fp = path.join(chainsDir, f);
      try { fs.chmodSync(fp, 0o644); } catch { /* ignore */ }
      try { fs.unlinkSync(fp); } catch { /* ignore */ }
    }
  }
}

beforeAll(async () => {
  const { knex } = await import("../../src/db/connection");
  await setupTestTenant();
  await knex("approval_rules").update({
    auto_approve_below: "999999999.00",
    is_active: true,
  });
});

afterEach(async () => {
  const { knex } = await import("../../src/db/connection");
  await cleanupTestTenant();
  await setupTestTenant();
  await knex("approval_rules").update({
    auto_approve_below: "999999999.00",
    is_active: true,
  });
  cleanChainFiles();
});

afterAll(async () => {
  await closeKnex();
});

describe("gl_post_transaction", () => {
  it("posts a valid MANUAL_JOURNAL and returns POSTED", async () => {
    const result = await handlePostTransaction({
      transaction_type: "MANUAL_JOURNAL",
      reference: "MCP-TEST-001",
      date: "2026-03-10",
      description: "Test journal via MCP",
      lines: [
        { description: "Debit bank", net_amount: 500, account_override: "1000" },
        { description: "Credit debtors", net_amount: -500, account_override: "1100" },
      ],
      idempotency_key: "mcp-test-001",
    }, context);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe("POSTED");
    expect(data.transaction_id).toBeDefined();
    expect(data.chain_hash).toBeDefined();
  });

  it("returns an error when a required field is missing", async () => {
    const result = await handlePostTransaction({
      transaction_type: "MANUAL_JOURNAL",
      reference: "MCP-TEST-002",
      date: "",  // invalid date
      description: "Bad transaction",
      lines: [{ description: "line", net_amount: 100, account_override: "1000" }],
      idempotency_key: "mcp-test-002",
    }, context);

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe("ERROR");
    expect(data.error_code).toBeDefined();
  });
});

describe("gl_query_journal", () => {
  it("returns posted transactions filtered by type", async () => {
    await handlePostTransaction({
      transaction_type: "MANUAL_JOURNAL",
      reference: "MCP-Q-001",
      date: "2026-03-10",
      description: "Journal 1",
      lines: [
        { description: "Dr bank", net_amount: 200, account_override: "1000" },
        { description: "Cr debtors", net_amount: -200, account_override: "1100" },
      ],
      idempotency_key: "mcp-q-001",
    }, context);

    await handlePostTransaction({
      transaction_type: "MANUAL_JOURNAL",
      reference: "MCP-Q-002",
      date: "2026-03-11",
      description: "Journal 2",
      lines: [
        { description: "Dr bank", net_amount: 300, account_override: "1000" },
        { description: "Cr debtors", net_amount: -300, account_override: "1100" },
      ],
      idempotency_key: "mcp-q-002",
    }, context);

    const result = await handleQueryJournal({
      transaction_type: "MANUAL_JOURNAL",
      period: "2026-03",
      page: 1,
      page_size: 10,
    }, context);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(2);
    expect(data.data.length).toBeGreaterThanOrEqual(2);
    const types = (data.data as Array<{ transaction_type: string }>).map((t) => t.transaction_type);
    expect(types.every((t) => t === "MANUAL_JOURNAL")).toBe(true);
  });
});

describe("gl_get_trial_balance", () => {
  it("returns a balanced trial balance after posting", async () => {
    await handlePostTransaction({
      transaction_type: "MANUAL_JOURNAL",
      reference: "MCP-TB-001",
      date: "2026-03-10",
      description: "Trial balance test",
      lines: [
        { description: "Dr bank", net_amount: 1000, account_override: "1000" },
        { description: "Cr debtors", net_amount: -1000, account_override: "1100" },
      ],
      idempotency_key: "mcp-tb-001",
    }, context);

    const result = await handleGetTrialBalance({ period: "2026-03" }, context);

    expect(result.isError).toBeFalsy();
    const report = JSON.parse(result.content[0].text);
    expect(report.lines).toBeDefined();
    const lines = report.lines as Array<{ debit: string; credit: string }>;
    const totalDebit = lines.reduce((sum, l) => sum + parseFloat(l.debit || "0"), 0);
    const totalCredit = lines.reduce((sum, l) => sum + parseFloat(l.credit || "0"), 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });
});

describe("gl_list_accounts", () => {
  it("returns all seeded active accounts", async () => {
    const result = await handleListAccounts({ active_only: true }, context);

    expect(result.isError).toBeFalsy();
    const accounts = JSON.parse(result.content[0].text);
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThanOrEqual(10);
    const codes = (accounts as Array<{ code: string }>).map((a) => a.code);
    expect(codes).toContain("1000");
    expect(codes).toContain("1100");
    expect(codes).toContain("4000");
  });

  it("filters by category", async () => {
    const result = await handleListAccounts({ category: "ASSET", active_only: true }, context);
    expect(result.isError).toBeFalsy();
    const accounts = JSON.parse(result.content[0].text);
    const cats = (accounts as Array<{ category: string }>).map((a) => a.category);
    expect(cats.every((c) => c === "ASSET")).toBe(true);
  });
});

describe("gl_approve_transaction", () => {
  it("approves a staged transaction and commits it", async () => {
    const { knex } = await import("../../src/db/connection");
    // Set approval threshold low so transactions queue for approval
    await knex("approval_rules").update({ auto_approve_below: "0.01" });

    const postResult = await handlePostTransaction({
      transaction_type: "MANUAL_JOURNAL",
      reference: "MCP-APPROVE-001",
      date: "2026-03-10",
      description: "Needs approval",
      lines: [
        { description: "Dr bank", net_amount: 100, account_override: "1000" },
        { description: "Cr debtors", net_amount: -100, account_override: "1100" },
      ],
      idempotency_key: "mcp-approve-001",
    }, context);

    expect(postResult.isError).toBeFalsy();
    const staged = JSON.parse(postResult.content[0].text);
    expect(staged.status).toBe("AWAITING_APPROVAL");
    const stagingId = staged.staging_id as string;

    // Reset threshold for approval to work
    await knex("approval_rules").update({ auto_approve_below: "999999999.00" });

    const approveResult = await handleApproveTransaction({
      staging_id: stagingId,
      notes: "Approved via MCP test",
    }, context);

    expect(approveResult.isError).toBeFalsy();
    const approved = JSON.parse(approveResult.content[0].text);
    expect(approved.status).toBe("POSTED");
    expect(approved.transaction_id).toBeDefined();
  });
});

describe("gl_verify_chain", () => {
  it("reports valid=true after posting transactions", async () => {
    await handlePostTransaction({
      transaction_type: "MANUAL_JOURNAL",
      reference: "MCP-CHAIN-001",
      date: "2026-03-10",
      description: "Chain verify test",
      lines: [
        { description: "Dr bank", net_amount: 250, account_override: "1000" },
        { description: "Cr debtors", net_amount: -250, account_override: "1100" },
      ],
      idempotency_key: "mcp-chain-001",
    }, context);

    const result = await handleVerifyChain({ period: "2026-03" }, context);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.valid).toBe(true);
    expect(data.entries).toBeGreaterThanOrEqual(2);
  });
});

// src/mcp/resources.ts
// MCP resource definitions and handlers.
// Resources expose read-only GL reference data as context for AI agents.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as accountsDb from "../db/queries/accounts";
import * as periodsDb from "../db/queries/periods";
import * as approvalsDb from "../db/queries/approvals";
import { knex } from "../db/connection";
import type { McpContext } from "./auth";

type ResourceResult = {
  contents: Array<{ uri: string; text: string; mimeType?: string }>;
};

// gl://accounts - Chart of accounts
async function readAccountsResource(context: McpContext): Promise<ResourceResult> {
  const accounts = await accountsDb.listAccounts({ active_only: true });
  const text = JSON.stringify(accounts, null, 2);
  return { contents: [{ uri: "gl://accounts", text, mimeType: "application/json" }] };
}

// gl://periods - Recent accounting period list
async function readPeriodsResource(context: McpContext): Promise<ResourceResult> {
  const periods = await periodsDb.listPeriods();
  const recent = periods.slice(0, 6);
  const text = JSON.stringify(recent, null, 2);
  return { contents: [{ uri: "gl://periods", text, mimeType: "application/json" }] };
}

// gl://transaction-types - Transaction type catalogue
async function readTransactionTypesResource(context: McpContext): Promise<ResourceResult> {
  const rows = await knex("transaction_type_mappings")
    .where({ is_active: true })
    .select("transaction_type", "debit_rules", "credit_rules")
    .orderBy("transaction_type", "asc");
  const parseRules = (r: unknown): unknown[] => {
    if (Array.isArray(r)) return r as unknown[];
    if (typeof r === "string") { try { return JSON.parse(r) as unknown[]; } catch { return []; } }
    return [];
  };
  const types = (rows as Array<{ transaction_type: string; debit_rules: unknown; credit_rules: unknown }>)
    .map((row) => ({
      code: row.transaction_type,
      debit_rules: parseRules(row.debit_rules),
      credit_rules: parseRules(row.credit_rules),
    }));
  const text = JSON.stringify(types, null, 2);
  return { contents: [{ uri: "gl://transaction-types", text, mimeType: "application/json" }] };
}

// gl://approval-queue - Pending approvals summary
async function readApprovalQueueResource(context: McpContext): Promise<ResourceResult> {
  const entries = await approvalsDb.listPendingApprovals({});
  const summary = {
    pending_count: entries.length,
    items: entries.slice(0, 20).map((e) => ({
      staging_id: e.staging_id,
      transaction_type: e.transaction_type,
      reference: e.reference ?? null,
      gross_amount: e.gross_amount ?? null,
      submitted_by: e.submitted_by ?? null,
    })),
  };
  const text = JSON.stringify(summary, null, 2);
  return { contents: [{ uri: "gl://approval-queue", text, mimeType: "application/json" }] };
}

// registerResources
export function registerResources(server: McpServer, context: McpContext): void {
  server.resource(
    "gl-accounts",
    "gl://accounts",
    { description: "The complete chart of accounts for this business." },
    (_uri) => readAccountsResource(context)
  );
  server.resource(
    "gl-periods",
    "gl://periods",
    { description: "Current and recent accounting period information." },
    (_uri) => readPeriodsResource(context)
  );
  server.resource(
    "gl-transaction-types",
    "gl://transaction-types",
    { description: "Catalogue of all supported transaction types with default account mappings." },
    (_uri) => readTransactionTypesResource(context)
  );
  server.resource(
    "gl-approval-queue",
    "gl://approval-queue",
    { description: "Transactions currently pending approval." },
    (_uri) => readApprovalQueueResource(context)
  );
}

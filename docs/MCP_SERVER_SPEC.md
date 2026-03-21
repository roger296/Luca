# MCP Server Specification — General Ledger V1

## Overview

The MCP (Model Context Protocol) server provides AI agents with structured access to the General Ledger module. It runs as a separate process communicating via stdio transport and exposes GL operations as MCP tools and GL reference data as MCP resources.

The MCP server is a **transport layer only** — it contains no business logic. Every tool handler delegates to the same engine functions that the REST API handlers use. This ensures identical validation, approval workflows, and audit trails regardless of whether a human uses the web UI, a module calls the REST API, or an AI agent uses MCP.

## Technology

- **SDK**: `@modelcontextprotocol/sdk` (latest version)
- **Transport**: Stdio (the server reads from stdin and writes to stdout using JSON-RPC)
- **Language**: TypeScript
- **Entry point**: `src/mcp/server.ts`

## Architecture

```
┌─────────────────┐     stdio      ┌──────────────────┐
│   AI Agent       │ ◄────────────► │   MCP Server     │
│   (Claude, etc.) │   JSON-RPC     │   src/mcp/       │
└─────────────────┘                 │   server.ts      │
                                    │   tools.ts       │
                                    │   resources.ts   │
                                    │   auth.ts        │
                                    └──────┬───────────┘
                                           │ direct function calls
                                    ┌──────▼───────────┐
                                    │   Engine Layer    │
                                    │   src/engine/     │
                                    │   posting.ts      │
                                    │   approval.ts     │
                                    │   periods.ts      │
                                    │   reports.ts      │
                                    └──────┬───────────┘
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                       ┌──────▼──────┐           ┌──────▼──────┐
                       │  Chain Files │           │  PostgreSQL  │
                       │  (authority) │           │  (mirror DB) │
                       └─────────────┘           └─────────────┘
```

The MCP server imports engine functions directly — it does NOT make HTTP calls to the REST API. This avoids the overhead and latency of an extra network hop.

## Authentication

The MCP server runs as a local process on the user's machine. Authentication is handled via environment variables:

```
MCP_USER_ID=agent@company.com  # The user identity for audit trail
DATABASE_URL=postgresql://...  # Database connection (shared with REST API)
CHAIN_FILE_PATH=/data/chains   # Chain file storage (shared with REST API)
```

The `auth.ts` module reads these and creates a context object passed to all tool handlers:

```typescript
// src/mcp/auth.ts

export interface McpContext {
  userId: string;
  sourceModule: string;  // always 'mcp-agent' for MCP-originated actions
}

export function getContext(): McpContext {
  const userId = process.env.MCP_USER_ID;
  if (!userId) {
    throw new Error('MCP_USER_ID environment variable is required');
  }
  return {
    userId,
    sourceModule: 'mcp-agent'
  };
}
```

All transactions submitted via MCP have `source.module_id = 'mcp-agent'` in the chain entry, making it clear in the audit trail that an AI agent submitted them.

## Server Setup

```typescript
// src/mcp/server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { getContext } from './auth.js';
import { initDatabase } from '../db/connection.js';

async function main() {
  // Initialise database connection
  await initDatabase();

  // Get authentication context
  const context = getContext();

  // Create MCP server
  const server = new McpServer({
    name: 'gl-ledger',
    version: '1.0.0',
  });

  // Register tools and resources
  registerTools(server, context);
  registerResources(server, context);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Tool Definitions

Each tool is defined with a name, description, input schema (JSON Schema), and a handler function.

### gl_post_transaction

**Purpose**: Submit a financial transaction to the GL. This is the core tool — it's the MCP equivalent of `POST /api/v1/gl/transactions`.

**Description for AI agents**: "Submit a financial transaction to the General Ledger for posting. The transaction will be validated, expanded into double-entry postings using configured account mappings, and either auto-approved (posted immediately to the immutable chain) or queued for manual review based on the business's approval rules. Returns the posting result including the transaction ID and chain hash if posted, or staging details if awaiting approval."

**Input Schema**:

```json
{
  "type": "object",
  "required": ["transaction_type", "reference", "date", "description", "lines", "idempotency_key"],
  "properties": {
    "transaction_type": {
      "type": "string",
      "description": "The type of transaction. Common types: CUSTOMER_INVOICE, SUPPLIER_INVOICE, CUSTOMER_PAYMENT, SUPPLIER_PAYMENT, MANUAL_JOURNAL, BANK_RECEIPT, BANK_PAYMENT. Use gl://transaction-types resource for the full catalogue.",
      "enum": ["CUSTOMER_INVOICE", "CUSTOMER_CREDIT_NOTE", "CUSTOMER_PAYMENT", "BAD_DEBT_WRITE_OFF", "SUPPLIER_INVOICE", "SUPPLIER_CREDIT_NOTE", "SUPPLIER_PAYMENT", "STOCK_RECEIPT", "STOCK_DISPATCH", "STOCK_WRITE_OFF", "STOCK_TRANSFER", "STOCK_REVALUATION", "BANK_RECEIPT", "BANK_PAYMENT", "BANK_TRANSFER", "MANUAL_JOURNAL", "PRIOR_PERIOD_ADJUSTMENT", "PERIOD_END_ACCRUAL", "PREPAYMENT_RECOGNITION", "DEPRECIATION", "FX_REVALUATION"]
    },
    "reference": {
      "type": "string",
      "description": "Your reference for this transaction (invoice number, payment reference, etc.)"
    },
    "date": {
      "type": "string",
      "format": "date",
      "description": "The accounting date of the transaction (ISO 8601 date, e.g., '2026-03-05'). Determines which accounting period the transaction falls in."
    },
    "currency": {
      "type": "string",
      "default": "GBP",
      "description": "Currency code (ISO 4217). Default is the instance's base currency."
    },
    "exchange_rate": {
      "type": "string",
      "description": "Exchange rate: 1 unit of transaction currency = this many units of base currency. Required if currency differs from base currency."
    },
    "counterparty": {
      "type": "object",
      "description": "The other party in this transaction (customer, supplier). Required for invoice and payment types.",
      "properties": {
        "trading_account_id": {
          "type": "string",
          "description": "The trading account ID (e.g., 'TA-CUST-0445-GBP')"
        },
        "contact_id": {
          "type": "string",
          "description": "The contact ID (e.g., 'CONTACT-0087')"
        }
      }
    },
    "description": {
      "type": "string",
      "description": "Human-readable description of this transaction"
    },
    "lines": {
      "type": "array",
      "description": "The financial line items. For most transaction types, provide net amount and tax — the GL will expand into the correct debit/credit postings.",
      "items": {
        "type": "object",
        "required": ["description", "net_amount", "tax_code", "tax_amount"],
        "properties": {
          "description": {
            "type": "string",
            "description": "Description of this line item"
          },
          "net_amount": {
            "type": "number",
            "description": "Net amount before tax"
          },
          "tax_code": {
            "type": "string",
            "description": "Tax code (e.g., 'STANDARD_VAT_20', 'REDUCED_VAT_5', 'ZERO_RATED', 'EXEMPT')"
          },
          "tax_amount": {
            "type": "number",
            "description": "Tax amount"
          },
          "account_override": {
            "type": "string",
            "description": "Override the default account code for this line. Use gl://accounts resource to find valid codes."
          },
          "cost_centre": {
            "type": "string",
            "description": "Cost centre code for departmental analysis"
          },
          "department": {
            "type": "string",
            "description": "Department code"
          }
        }
      }
    },
    "adjustment_context": {
      "type": "object",
      "description": "Required for PRIOR_PERIOD_ADJUSTMENT transactions.",
      "properties": {
        "original_period": { "type": "string" },
        "original_transaction_id": { "type": "string" },
        "reason": { "type": "string" },
        "authorised_by": { "type": "string" }
      }
    },
    "idempotency_key": {
      "type": "string",
      "description": "A unique key to prevent duplicate postings if retried. Use a format like 'module-reference' (e.g., 'sales-INV-2026-00142')."
    },
    "approval_context": {
      "type": "object",
      "description": "Optional context for approval rules.",
      "properties": {
        "confidence_score": {
          "type": "number",
          "description": "AI confidence score (0.0 to 1.0). Transactions below the configured threshold will require manual approval."
        }
      }
    }
  }
}
```

**Handler implementation**:

```typescript
async function handlePostTransaction(args: PostTransactionInput, context: McpContext) {
  try {
    const result = await postingEngine.submitTransaction(
      {
        ...args,
        source: {
          module_id: context.sourceModule,
          module_reference: args.reference,
        },
      },
      context.userId
    );
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'REJECTED',
          error_code: error.code || 'INTERNAL_ERROR',
          message: error.message
        }, null, 2)
      }],
      isError: true
    };
  }
}
```

### gl_query_journal

**Description**: "Search committed transactions in the General Ledger. Returns matching transactions with their posting details. Use this to find specific invoices, payments, or to review recent activity."

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "period": { "type": "string", "description": "Accounting period (e.g., '2026-03')" },
    "date_from": { "type": "string", "format": "date" },
    "date_to": { "type": "string", "format": "date" },
    "transaction_type": { "type": "string" },
    "account_code": { "type": "string", "description": "Filter by account code" },
    "counterparty": { "type": "string", "description": "Trading account ID or contact ID" },
    "reference": { "type": "string", "description": "Search by reference (partial match)" },
    "amount_min": { "type": "string" },
    "amount_max": { "type": "string" },
    "page": { "type": "number", "default": 1 },
    "page_size": { "type": "number", "default": 20 }
  }
}
```

### gl_get_trial_balance

**Description**: "Get the trial balance for a specific accounting period. Shows every account with a non-zero balance, with debit and credit columns. The trial balance must always balance (total debits = total credits). Includes a data flag indicating whether the figures are final (AUTHORITATIVE) or still subject to change (PROVISIONAL)."

**Input Schema**:

```json
{
  "type": "object",
  "required": ["period"],
  "properties": {
    "period": { "type": "string", "description": "Accounting period (e.g., '2026-03')" },
    "include_comparatives": { "type": "boolean", "default": false, "description": "Include prior period for comparison" }
  }
}
```

### gl_get_account_balance

**Description**: "Get the current balance of a specific general ledger account. Returns the debit balance, credit balance, and net balance."

**Input Schema**:

```json
{
  "type": "object",
  "required": ["account_code"],
  "properties": {
    "account_code": { "type": "string", "description": "Account code (e.g., '1100' for Trade Debtors, '4000' for Sales Revenue). Use gl://accounts resource to find valid codes." },
    "as_at_date": { "type": "string", "format": "date", "description": "Balance as at this date. Defaults to today." }
  }
}
```

### gl_list_accounts

**Description**: "List or search the chart of accounts. Returns account codes, names, types (asset/liability/equity/revenue/expense), and whether each account is active. Use this to find the right account code when posting transactions."

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "category": { "type": "string", "enum": ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], "description": "Filter by account category" },
    "search": { "type": "string", "description": "Search by name or code" },
    "active_only": { "type": "boolean", "default": true }
  }
}
```

### gl_get_period_status

**Description**: "Check the status of an accounting period. Returns the period's date range, status (OPEN, SOFT_CLOSE, or HARD_CLOSE), data flag, and closing details if closed. If no period is specified, returns the current open period."

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "period": { "type": "string", "description": "Period to check (e.g., '2026-03'). If omitted, returns the current open period." }
  }
}
```

### gl_approve_transaction

**Description**: "Approve a transaction that is pending in the approval queue. The transaction will be committed to the immutable chain and the database mirror. If the approval rule requires multiple approvals, this adds one approval — the transaction is committed only when all required approvals are received."

**Input Schema**:

```json
{
  "type": "object",
  "required": ["staging_id"],
  "properties": {
    "staging_id": { "type": "string", "description": "The staging ID of the pending transaction" },
    "notes": { "type": "string", "description": "Optional notes to record with the approval" }
  }
}
```

### gl_reject_transaction

**Description**: "Reject a transaction that is pending in the approval queue. The transaction will not be posted. A reason must be provided."

**Input Schema**:

```json
{
  "type": "object",
  "required": ["staging_id", "reason"],
  "properties": {
    "staging_id": { "type": "string", "description": "The staging ID of the pending transaction" },
    "reason": { "type": "string", "description": "Reason for rejection" }
  }
}
```

### gl_verify_chain

**Description**: "Verify the integrity of the hash chain for a specific accounting period. Checks that every entry's hash is correct and that the chain of hashes is unbroken. For closed periods, also verifies the Merkle root. Use this to confirm that the ledger has not been tampered with."

**Input Schema**:

```json
{
  "type": "object",
  "required": ["period"],
  "properties": {
    "period": { "type": "string", "description": "Period to verify (e.g., '2026-03')" }
  }
}
```

## Resource Definitions

Resources are read-only data that AI agents can request for context. They help agents make informed decisions without requiring multiple tool calls.

### gl://accounts

**Description**: "The complete chart of accounts for this business. Shows every active account with its code, name, type (asset, liability, equity, revenue, expense), sub-category, and current-period balance. Use this to determine which account codes to use when posting transactions."

**Handler**: Query all active accounts for the company, including current-period balances. Format as a readable text table:

```
Code    Name                          Type        Category         Balance
────────────────────────────────────────────────────────────────────────────
1000    Bank Current Account          ASSET       CURRENT_ASSET    15,420.50 Dr
1100    Trade Debtors                 ASSET       CURRENT_ASSET    12,400.00 Dr
2000    Trade Creditors               LIABILITY   CURRENT_LIABILITY 5,320.00 Cr
4000    Sales Revenue — Trade         REVENUE     -                42,800.00 Cr
5000    Cost of Goods Sold            EXPENSE     DIRECT_COSTS     18,200.00 Dr
...
```

### gl://periods

**Description**: "Current and recent accounting period information. Shows each period's date range, status (OPEN for accepting transactions, SOFT_CLOSE for month-end adjustments only, HARD_CLOSE for permanently sealed), and data reliability flag."

**Handler**: Query the last 6 periods:

```
Period    Dates                  Status       Data Flag
─────────────────────────────────────────────────────────
2026-03   01 Mar - 31 Mar 2026   OPEN         PROVISIONAL
2026-02   01 Feb - 28 Feb 2026   HARD_CLOSE   AUTHORITATIVE
2026-01   01 Jan - 31 Jan 2026   HARD_CLOSE   AUTHORITATIVE
```

### gl://transaction-types

**Description**: "Catalogue of all supported transaction types with descriptions, required fields, and default account mappings. Reference this when deciding which transaction type to use for a business event."

**Handler**: Return the transaction type catalogue:

```
CUSTOMER_INVOICE
  Description: Record a sale to a customer
  Category: Sales and Receivables
  Required: reference, date, counterparty, lines (with net_amount, tax_code, tax_amount)
  Default postings:
    Debit: Trade Debtors (1100) for gross amount
    Credit: Sales Revenue (4000) for net amount
    Credit: VAT Output (2100) for tax amount

SUPPLIER_INVOICE
  Description: Recognise an invoice received from a supplier
  ...
```

### gl://approval-queue

**Description**: "Transactions currently pending approval. Shows how many items are waiting, their total value, and a summary of each pending transaction."

**Handler**: Query the staging table for pending items:

```
Pending Approvals: 3 items totalling £12,450.00

1. STG-20260305-001 | SUPPLIER_INVOICE | £2,450.00 | from: ai-invoice-processor
   Description: Raw steel plate from Sheffield Steel Ltd
   Confidence: 0.92 | Waiting since: 2 hours ago

2. STG-20260305-002 | MANUAL_JOURNAL | £8,500.00 | from: general-ledger
   Description: Year-end accrual for audit fees
   Waiting since: 4 hours ago

3. STG-20260305-003 | CUSTOMER_CREDIT_NOTE | £1,500.00 | from: sales-and-customer
   Description: Credit for returned goods — Northern Building Supplies
   Waiting since: 30 minutes ago
```

## Error Handling

All tool handlers must catch errors and return them as structured error responses rather than throwing. The MCP server should never crash due to a business logic error.

```typescript
function wrapHandler(handler: Function) {
  return async (args: unknown) => {
    try {
      return await handler(args);
    } catch (error) {
      const errorResponse = {
        status: 'ERROR',
        error_code: (error as any).code || 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(errorResponse, null, 2)
        }],
        isError: true
      };
    }
  };
}
```

## Testing Strategy

MCP tool tests should NOT use the stdio transport. Instead, import the tool handler functions directly and call them with test data:

```typescript
// tests/unit/mcp/tools.test.ts

import { handlePostTransaction } from '../../../src/mcp/tools';

describe('MCP gl_post_transaction', () => {
  it('should post a valid manual journal', async () => {
    const context = { userId: 'test@co.com', sourceModule: 'mcp-agent' };
    const result = await handlePostTransaction({
      transaction_type: 'MANUAL_JOURNAL',
      reference: 'MCP-TEST-001',
      date: '2026-03-05',
      description: 'Test journal via MCP',
      lines: [
        { description: 'Debit office supplies', net_amount: 100, tax_code: 'ZERO_RATED', tax_amount: 0, account_override: '6200' },
        { description: 'Credit bank', net_amount: 100, tax_code: 'ZERO_RATED', tax_amount: 0, account_override: '1000' }
      ],
      idempotency_key: 'mcp-test-001'
    }, context);

    expect(result.status).toBe('POSTED');
    expect(result.transaction_id).toBeDefined();
  });
});
```

Integration tests should verify that transactions posted via MCP appear in the chain file and the database, and that the audit trail correctly shows `source.module_id = 'mcp-agent'`.

## Claude Desktop Configuration

To use the MCP server with Claude Desktop, add this to the MCP configuration:

```json
{
  "mcpServers": {
    "gl-ledger": {
      "command": "npx",
      "args": ["tsx", "/path/to/gl-v1/src/mcp/server.ts"],
      "env": {
        "MCP_USER_ID": "your-email@company.com",
        "DATABASE_URL": "postgresql://gl_admin:gl_dev_password_change_me@localhost:5432/gl_ledger",
        "CHAIN_FILE_PATH": "/path/to/gl-v1/chains"
      }
    }
  }
}
```

## Folder-Watching Scenario

The MCP server enables the automated bookkeeping scenario described in the system architecture (Section 11.3). An AI agent with access to the MCP tools can:

1. Receive a document (supplier invoice PDF) from a user or a folder-watching process.
2. Analyse the document to extract supplier, amounts, line items, and tax.
3. Call `gl_list_accounts` (or read `gl://accounts`) to determine the correct expense accounts.
4. Call `gl_post_transaction` with type `SUPPLIER_INVOICE`, the extracted data, and a confidence score.
5. If the confidence is high and the amount is below the auto-approval threshold, the transaction is posted immediately.
6. If confidence is low or the amount is above the threshold, the transaction enters the approval queue, and the business owner reviews it through the web UI.

The AI agent does not need any custom integration code — it discovers the available tools through the MCP protocol and uses them the same way it would use any other MCP server.

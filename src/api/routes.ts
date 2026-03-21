import { Router } from "express";
import { authenticate } from "./middleware/auth";
import * as transactions from "./transactions";
import * as accounts from "./accounts";
import * as periods from "./periods";
import * as approvals from "./approvals";
import * as reports from "./reports";
import * as chain from "./chain";
import * as webhooks from "./webhooks";
import * as txTypes from "./transaction-types";
import * as exchangeRates from "./exchange-rates";
import * as modulesApi from "./modules";
import * as delegationsApi from "./delegations";
import * as reconciliations from "./reconciliations";

const router = Router();

// All routes require authentication.
router.use(authenticate);

// ─── Transactions ──────────────────────────────────────────────────────────
router.post("/transactions/bulk", transactions.submitBulkTransactions);
router.post("/transactions", transactions.submitTransaction);
router.get("/transactions", transactions.getTransactions);
router.get("/transactions/:id", transactions.getTransactionById);

// ─── Accounts ──────────────────────────────────────────────────────────────
router.get("/accounts", accounts.listAccounts);
router.post("/accounts", accounts.createAccount);
router.put("/accounts/:code", accounts.updateAccount);
router.get("/accounts/:code/balance", accounts.getAccountBalance);
router.get("/accounts/:code/ledger", accounts.getAccountLedger);

// ─── Periods ───────────────────────────────────────────────────────────────
// NOTE: /periods/current must be registered before /periods/:id/status
// to prevent Express matching "current" as the :id param.
router.get("/periods", periods.listPeriods);
router.get("/periods/current", periods.getCurrentPeriod);
router.get("/periods/:id/status", periods.getPeriodStatus);
router.post("/periods/:id/soft-close", periods.softClosePeriod);
router.post("/periods/:id/close", periods.hardClosePeriod);

// ─── Approvals ─────────────────────────────────────────────────────────────
// NOTE: /approvals/bulk-approve must be before /approvals/:staging_id to
// prevent Express matching "bulk-approve" as the staging_id param.
router.get("/approvals/pending", approvals.listPendingApprovals);
router.post("/approvals/bulk-approve", approvals.bulkApprove);
router.get("/approvals/:staging_id", approvals.getApprovalItem);
router.post("/approvals/:staging_id/approve", approvals.approveTransaction);
router.post("/approvals/:staging_id/reject", approvals.rejectTransaction);

// ─── Reports ───────────────────────────────────────────────────────────────
router.get("/reports/trial-balance", reports.getTrialBalance);
router.get("/reports/profit-and-loss", reports.getProfitAndLoss);
router.get("/reports/balance-sheet", reports.getBalanceSheet);
router.get("/reports/cash-flow", reports.getCashFlow);

// ─── Chain ─────────────────────────────────────────────────────────────────
router.get("/chain/verify", chain.verifyChain);
router.get("/chain/checkpoint/:period", chain.getCheckpoint);
router.get("/chain/proof/:transaction_id", chain.getMerkleProof);

// ─── Webhooks ──────────────────────────────────────────────────────────────
router.get("/webhooks", webhooks.listWebhooks);
router.post("/webhooks", webhooks.createWebhook);
router.delete("/webhooks/:id", webhooks.deleteWebhook);
router.get("/webhooks/:id/deliveries", webhooks.getWebhookDeliveries);
router.post("/webhooks/:id/test", webhooks.testWebhook);

// ─── Transaction types ─────────────────────────────────────────────────────
router.get("/transaction-types", txTypes.listTransactionTypes);

// Exchange rates
router.post("/exchange-rates", exchangeRates.setExchangeRate);
router.get("/exchange-rates", exchangeRates.listExchangeRates);

// ─── Delegations ────────────────────────────────────────────────────────────
router.get("/delegations", delegationsApi.listDelegationsHandler);
router.post("/delegations", delegationsApi.createDelegationHandler);
router.delete("/delegations/:id", delegationsApi.revokeDelegationHandler);

// ─── Modules ────────────────────────────────────────────────────────────────
router.get("/modules", modulesApi.listModules);
router.post("/modules", modulesApi.registerModule);
router.put("/modules/:module_id/key", modulesApi.updateModuleKey);

// ─── Reconciliations ─────────────────────────────────────────────────────────
router.post("/reconciliations", reconciliations.createReconciliation);
router.get("/reconciliations", reconciliations.listReconciliations);

export default router;

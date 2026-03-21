// Domain types and interfaces for the GL engine

// ── Account ───────────────────────────────────────────────────────────────────

export type AccountCategory = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export interface Account {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  type: string | null;
  active: boolean;
}

// ── Period ────────────────────────────────────────────────────────────────────

export type PeriodStatus = "OPEN" | "SOFT_CLOSE" | "HARD_CLOSE";
export type DataFlag = "PROVISIONAL" | "AUTHORITATIVE";

export interface Period {
  id: string;
  period_id: string; // YYYY-MM
  status: PeriodStatus;
  data_flag: DataFlag;
  opening_hash: string | null;
  closing_hash: string | null;
  merkle_root: string | null;
  sub_ledger_reconciliations: Record<string, unknown> | null;
}

// ── Transaction submission ─────────────────────────────────────────────────────

export interface TransactionLineInput {
  account_code?: string; // override — only allowed when allow_override=true
  description: string;
  net_amount: string;
  tax_code?: string;
  tax_amount?: string;
  cost_centre?: string;
  department?: string;
  dimensions?: Record<string, string>;
}

export interface ApprovalContext {
  submitted_by: string;
  required_approver?: string;
  required_approver_role?: string;
  notes?: string;
}

export interface TransactionSubmission {
  transaction_type: string;
  reference?: string;
  date: string; // YYYY-MM-DD
  period_id?: string; // defaults to current open period
  currency?: string; // defaults to instance base currency
  exchange_rate?: string; // required when currency != base_currency
  counterparty?: {
    trading_account_id?: string;
    contact_id?: string;
  };
  description?: string;
  lines: TransactionLineInput[];
  source: {
    module_id: string;
    module_reference?: string;
    correlation_id?: string;
  };
  idempotency_key?: string;
  approval_context?: ApprovalContext;
  module_signature?: {
    module_id: string;
    algorithm: "Ed25519";
    signature: string;
    public_key_fingerprint: string;
  };
}

// ── Posted transaction ────────────────────────────────────────────────────────

export interface TransactionLine {
  id: string;
  transaction_id: string;
  account_code: string;
  description: string | null;
  debit: string;
  credit: string;
  base_debit: string;
  base_credit: string;
  cost_centre: string | null;
  sequence: number;
}

export interface Transaction {
  id: string;
  transaction_id: string;
  transaction_type: string;
  reference: string | null;
  date: string;
  period_id: string;
  currency: string;
  exchange_rate: string;
  base_currency: string;
  counterparty_trading_account_id: string | null;
  counterparty_contact_id: string | null;
  description: string | null;
  source_module: string | null;
  source_reference: string | null;
  correlation_id: string | null;
  idempotency_key: string | null;
  chain_sequence: number | null;
  chain_hash: string | null;
  merkle_index: number | null;
  module_signature: Record<string, unknown> | null;
  status: string;
  created_at: string;
  lines?: TransactionLine[];
}

// ── Posting result ────────────────────────────────────────────────────────────

export type PostingStatus = "POSTED" | "AWAITING_APPROVAL" | "REJECTED";

export interface PostingResult {
  status: PostingStatus;
  transaction_id?: string;
  staging_id?: string;
  error_code?: string;
  message?: string;
  chain_hash?: string;
  chain_sequence?: number;
}

// ── Staging (approval queue) ──────────────────────────────────────────────────

export type StagingStatus = "PENDING" | "PARTIALLY_APPROVED" | "APPROVED" | "REJECTED" | "ESCALATED";

export interface StagingApproval {
  approved_by: string;
  approved_at: string;
  notes?: string;
}

export interface StagingEntry {
  staging_id: string;
  transaction_type: string;
  reference: string | null;
  date: string;
  period_id: string;
  currency: string;
  exchange_rate: string | null;
  payload: TransactionSubmission;
  status: StagingStatus;
  submitted_by: string | null;
  required_approver: string | null;
  required_approver_role: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  approvals: StagingApproval[];
  idempotency_key: string | null;
  gross_amount: string | null;
  created_at: string;
}

// ── Approval delegation ──────────────────────────────────────────────────────

export interface ApprovalDelegation {
  id: string;
  delegator_id: string;  // user granting authority
  delegate_id: string;   // user receiving authority
  valid_from: string;
  valid_until: string;
  scope: {
    transaction_types?: string[];
    max_amount?: string;
  } | null;
  created_at: string;
}

// ── Approval rules ─────────────────────────────────────────────────────────────

export interface ApprovalRule {
  id: string;
  transaction_type: string | null;
  auto_approve_below: string | null;
  required_approver_role: string | null;
  approval_roles: string[];
  required_approvals: number;
  is_active: boolean;
}

// ── Transaction type mapping ───────────────────────────────────────────────────

export interface MappingRule {
  account_code: string;
  amount_source: "net" | "tax" | "gross";
  description_template: string;
  allow_override: boolean;
}

export interface TransactionTypeMapping {
  id: string;
  transaction_type: string;
  debit_rules: MappingRule[];
  credit_rules: MappingRule[];
  is_active: boolean;
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface TrialBalanceLine {
  account_code: string;
  account_name: string;
  category: AccountCategory;
  type: string | null;
  debit: string;
  credit: string;
}

export interface TrialBalanceReport {
  period_id: string;
  data_flag: DataFlag;
  as_at_date: string | null;
  lines: TrialBalanceLine[];
  total_debits: string;
  total_credits: string;
  balanced: boolean;
}

export interface PnLAccountLine {
  account_code: string;
  account_name: string;
  amount: string;
}

export interface PnLSection {
  name: string;
  category: string;
  accounts: PnLAccountLine[];
  total: string;
}

export interface ProfitAndLossReport {
  period_id: string;
  date_from: string;
  date_to: string;
  data_flag: DataFlag;
  sections: PnLSection[];
  gross_profit: string;
  total_overheads: string;
  net_profit: string;
}

export interface BalanceSheetSection {
  name: string;
  category: string;
  accounts: PnLAccountLine[];
  total: string;
}

export interface BalanceSheetReport {
  as_at_date: string;
  period_id: string;
  data_flag: DataFlag;
  assets: BalanceSheetSection[];
  liabilities: BalanceSheetSection[];
  equity: BalanceSheetSection[];
  total_assets: string;
  total_liabilities_and_equity: string;
  balanced: boolean;
}

export interface CashFlowAdjustment {
  description: string;
  amount: string;
}

export interface CashFlowReport {
  period_id: string;
  date_from: string;
  date_to: string;
  data_flag: DataFlag;
  operating_activities: {
    net_profit: string;
    adjustments: CashFlowAdjustment[];
    working_capital_changes: CashFlowAdjustment[];
    net_cash_from_operations: string;
  };
  investing_activities: {
    items: CashFlowAdjustment[];
    net_cash_from_investing: string;
  };
  financing_activities: {
    items: CashFlowAdjustment[];
    net_cash_from_financing: string;
  };
  net_change_in_cash: string;
  opening_cash: string;
  closing_cash: string;
}

// ── Registered module ─────────────────────────────────────────────────────────

export interface RegisteredModule {
  module_id: string;
  display_name: string;
  public_key: string | null;
  allowed_transaction_types: string[];
  is_active: boolean;
  registered_at: string;
}

// ── Webhook ───────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | "TRANSACTION_POSTED"
  | "TRANSACTION_APPROVED"
  | "TRANSACTION_REJECTED"
  | "PERIOD_SOFT_CLOSED"
  | "PERIOD_CLOSED"
  | "APPROVAL_ESCALATED";

export interface WebhookSubscription {
  id: string;
  callback_url: string;
  event_types: WebhookEventType[];
  secret: string;
  is_active: boolean;
  created_at: string;
  last_delivery_at: string | null;
  failure_count: number;
}

// ── Custom errors ─────────────────────────────────────────────────────────────

export class PeriodClosedError extends Error {
  constructor(periodId: string) {
    super(`Period ${periodId} is hard-closed and cannot accept new entries`);
    this.name = "PeriodClosedError";
  }
}

export class PeriodSoftClosedError extends Error {
  constructor(periodId: string) {
    super(`Period ${periodId} is soft-closed`);
    this.name = "PeriodSoftClosedError";
  }
}

export class PeriodNotFoundError extends Error {
  constructor(periodId: string) {
    super(`Period ${periodId} not found`);
    this.name = "PeriodNotFoundError";
  }
}

export class InvalidPeriodStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPeriodStateError";
  }
}

export class PeriodSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodSequenceError";
  }
}

export class StagingNotClearError extends Error {
  constructor(count: number) {
    super(`${count} pending transactions must be resolved before period close`);
    this.name = "StagingNotClearError";
  }
}

export class TrialBalanceError extends Error {
  constructor(debits: string, credits: string) {
    super(`Trial balance does not balance: debits=${debits} credits=${credits}`);
    this.name = "TrialBalanceError";
  }
}

export class InvalidModuleSignatureError extends Error {
  constructor(moduleId: string) {
    super(`Invalid digital signature from module ${moduleId}`);
    this.name = "InvalidModuleSignatureError";
  }
}

export class SegregationOfDutiesError extends Error {
  constructor(userId: string, relatedTransactionId: string) {
    super(
      `User ${userId} cannot approve: also submitted related transaction ${relatedTransactionId}`
    );
    this.name = "SegregationOfDutiesError";
  }
}

export class ExchangeRateRequiredError extends Error {
  constructor(currency: string, baseCurrency: string) {
    super(`Exchange rate required for ${currency} to ${baseCurrency} conversion`);
    this.name = "ExchangeRateRequiredError";
  }
}

export class CurrencyMismatchError extends Error {
  constructor(currency: string, baseCurrency: string) {
    super(`Currency mismatch: ${currency} rate provided but transaction is in base currency ${baseCurrency}`);
    this.name = "CurrencyMismatchError";
  }
}

export class AccountNotFoundError extends Error {
  constructor(code: string) {
    super(`Account ${code} not found`);
    this.name = "AccountNotFoundError";
  }
}

export class DuplicateIdempotencyKeyError extends Error {
  constructor(key: string) {
    super(`Transaction with idempotency key ${key} already exists`);
    this.name = "DuplicateIdempotencyKeyError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ModuleNotAuthorisedError extends Error {
  constructor(moduleId: string, transactionType: string) {
    super(`Module ${moduleId} is not authorised to post ${transactionType} transactions`);
    this.name = "ModuleNotAuthorisedError";
  }
}

export class UnregisteredModuleKeyError extends Error {
  constructor(moduleId: string) {
    super(`UNREGISTERED_MODULE_KEY: no public key registered for module ${moduleId}`);
    this.name = "UnregisteredModuleKeyError";
  }
}

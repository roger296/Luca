
export interface Account {
  id: string;
  code: string;
  name: string;
  category: string;
  account_type: string;
  is_active: boolean;
  balance?: { debit: string; credit: string; net: string };
}

export interface TransactionLine {
  line_number: number;
  account_code: string;
  description: string;
  debit: string;
  credit: string;
  base_debit: string;
  base_credit: string;
  cost_centre?: string;
}

export interface Transaction {
  id: string;
  transaction_id: string;
  transaction_type: string;
  reference: string;
  date: string;
  period_id: string;
  currency: string;
  exchange_rate?: string;
  base_currency: string;
  description?: string;
  submitted_by?: string;
  chain_hash?: string;
  merkle_index?: number;
  module_signature?: unknown;
  source_module?: string;
  source_reference?: string;
  correlation_id?: string;
  counterparty_trading_account_id?: string;
  lines?: TransactionLine[];
  total_debit?: string;
  total_credit?: string;
}

export interface Period {
  id: string;
  period_id: string;
  status: "OPEN" | "SOFT_CLOSE" | "HARD_CLOSE";
  data_flag: "PROVISIONAL" | "AUTHORITATIVE";
  start_date?: string;
  end_date?: string;
  closing_chain_hash?: string;
  merkle_root?: string;
  sub_ledger_reconciliations?: Record<string, { confirmed: boolean; confirmed_at?: string }>;
}

export interface StagingEntry {
  id: string;
  staging_id: string;
  transaction_type: string;
  reference: string;
  date: string;
  period_id: string;
  status: "PENDING" | "PARTIALLY_APPROVED" | "APPROVED" | "REJECTED" | "ESCALATED";
  submitted_by?: string;
  gross_amount?: string;
  currency?: string;
  source_module?: string;
  approvals?: Array<{ approved_by: string; approved_at: string; notes?: string }>;
  created_at: string;
  payload?: unknown;
}

export interface TrialBalanceLine {
  account_code: string;
  account_name: string;
  category: string;
  debit: string;
  credit: string;
}

export interface TrialBalanceReport {
  period_id: string;
  data_flag: "PROVISIONAL" | "AUTHORITATIVE";
  lines: TrialBalanceLine[];
  total_debit: string;
  total_credit: string;
  as_at_date?: string;
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
  data_flag: "PROVISIONAL" | "AUTHORITATIVE";
  sections: PnLSection[];
  gross_profit: string;
  total_overheads: string;
  net_profit: string;
  comparative?: ProfitAndLossReport;
}

export interface BalanceSheetReport {
  as_at_date: string;
  data_flag: "PROVISIONAL" | "AUTHORITATIVE";
  total_assets: string;
  total_liabilities: string;
  total_equity: string;
  sections: Array<{
    name: string;
    category: string;
    accounts: PnLAccountLine[];
    total: string;
  }>;
}

export interface CashFlowReport {
  period_id: string;
  data_flag: "PROVISIONAL" | "AUTHORITATIVE";
  operating_activities: {
    net_profit: string;
    adjustments: Array<{ label: string; amount: string }>;
    working_capital_changes: Array<{ label: string; amount: string }>;
    net_cash_from_operations: string;
  };
  investing_activities: { items: Array<{ label: string; amount: string }>; net_cash_from_investing: string };
  financing_activities: { items: Array<{ label: string; amount: string }>; net_cash_from_financing: string };
  net_change_in_cash: string;
  opening_cash: string;
  closing_cash: string;
}

export interface ChainEntry {
  sequence: number;
  timestamp: string;
  previous_hash: string;
  entry_hash: string;
  type: "TRANSACTION" | "GENESIS" | "PERIOD_CLOSE";
  merkle_position?: { index: number; depth: number } | null;
  payload?: Record<string, unknown>;
}

export interface WebhookSubscription {
  id: string;
  callback_url: string;
  event_types: string[];
  is_active: boolean;
  failure_count: number;
  created_at: string;
  last_delivery_at?: string;
}

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event_type: string;
  status: "PENDING" | "DELIVERED" | "FAILED" | "RETRYING";
  attempts: number;
  last_attempt_at?: string;
  last_response_status?: number;
  last_error?: string;
  created_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

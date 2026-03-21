// Chain file data structures

export type EntryType = "TRANSACTION" | "PERIOD_CLOSE" | "GENESIS";

export interface MerklePosition {
  index: number; // 0-based position among TRANSACTION entries in the period
  depth: number; // always 0 for leaf nodes
}

export interface ModuleSignature {
  module_id: string;
  algorithm: "Ed25519";
  signature: string; // base64-encoded
  public_key_fingerprint: string; // sha256 of public key
}

export interface ChainEntry {
  sequence: number;
  timestamp: string; // UTC ISO 8601
  previous_hash: string;
  entry_hash: string; // SHA-256 hex, "" when computing
  type: EntryType;
  merkle_position: MerklePosition | null;
  module_signature: ModuleSignature | null;
  payload: GenesisPayload | TransactionPayload | PeriodClosePayload;
}

export interface GenesisPayload {
  period_id: string;
  previous_period_id: string | null;
  previous_period_closing_hash: string | null;
  previous_period_merkle_root: string | null;
  opening_balances: Record<string, { debit: string; credit: string }>;
}

export interface TransactionPayload {
  transaction_id: string;
  transaction_type: string;
  reference: string | null;
  date: string; // YYYY-MM-DD
  currency: string;
  exchange_rate: string;
  base_currency: string;
  counterparty: {
    trading_account_id: string | null;
    contact_id: string | null;
  } | null;
  description: string | null;
  lines: TransactionPayloadLine[];
  source: {
    module_id: string;
    module_reference: string | null;
    correlation_id: string | null;
  };
  idempotency_key: string | null;
}

export interface TransactionPayloadLine {
  account_code: string;
  description: string | null;
  debit: string;
  credit: string;
  base_debit: string;
  base_credit: string;
  cost_centre: string | null;
}

export interface PeriodClosePayload {
  period_id: string;
  merkle_root: string;
  closing_trial_balance: Record<string, { debit: string; credit: string }>;
  total_transactions: number;
  total_debits: string;
  total_credits: string;
  closed_by: string;
  sub_ledger_reconciliations: Record<
    string,
    { confirmed: boolean; confirmed_at: string }
  >;
}

export interface MerkleTree {
  leaves: string[];
  levels: string[][];  // levels[0] = leaves, levels[last] = [root]
  root: string;
}

export interface MerkleProof {
  leaf_hash: string;
  leaf_index: number;
  proof_path: MerkleProofStep[];
  merkle_root: string;
}

export interface MerkleProofStep {
  hash: string;
  position: "left" | "right";
}

export interface ChainVerifyResult {
  valid: boolean;
  entries: number;
  merkle_valid?: boolean;
  error?: string;
}

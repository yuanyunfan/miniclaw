export type CmbTransactionDirection = "spend" | "refund";

export interface CmbCreditCardEmailConfig {
  email_profile: string;
  state_path: string;
  folders: string[];
  from: string[];
  subject_includes: string[];
  window_hours: number;
  max_results: number;
  currency: string;
  large_transaction_threshold: number;
  dedupe: boolean;
}

export interface CmbCreditCardTransaction {
  id: string;
  message_id_hash: string;
  occurred_at: string;
  direction: CmbTransactionDirection;
  amount: number;
  currency: string;
  merchant?: string;
  card_tail_hash?: string;
  source: "cmb-credit-card-email";
}

export interface CmbCreditCardStateEntry {
  transaction_id: string;
  message_id_hash: string;
  amount: number;
  currency: string;
  occurred_at: string;
  seen_at: string;
}

export interface CmbCreditCardState {
  updated_at: string;
  seen_transactions: Record<string, CmbCreditCardStateEntry>;
}

export interface CmbCreditCardCollectResult {
  generated_at: string;
  window_start: string;
  window_end: string;
  currency: string;
  transaction_count: number;
  skipped_duplicates: number;
  total_spend: number;
  total_refund: number;
  net_spend: number;
  large_transaction_threshold: number;
  large_transactions: CmbCreditCardTransaction[];
  transactions: CmbCreditCardTransaction[];
  warnings: string[];
}

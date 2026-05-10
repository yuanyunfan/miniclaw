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
  include_attachments: boolean;
  parse_attachment_text: boolean;
  attachment_text_max_bytes: number;
  allowed_attachment_extensions: string[];
  diagnostic_search: boolean;
  skip_when_no_new_transactions: boolean;
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
  source_medium: "body" | "attachment";
  source: "cmb-credit-card-email";
}

export interface CmbCreditCardEmailCandidate {
  received_at: string;
  from_domain?: string;
  subject_excerpt: string;
  attachment_count: number;
  attachment_types: string[];
  attachment_extraction_statuses: string[];
}

export interface CmbCreditCardDiagnostics {
  matched_email_count: number;
  candidate_email_count: number;
  attachment_count: number;
  downloadable_attachment_count: number;
  parsed_from_body_count: number;
  parsed_from_attachment_count: number;
  unsupported_attachment_count: number;
  failed_attachment_count: number;
  skipped_reason_counts: Record<string, number>;
  latest_candidates: CmbCreditCardEmailCandidate[];
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
  diagnostics: CmbCreditCardDiagnostics;
  warnings: string[];
}

export type EmailProvider = "imap" | "gmail" | "graph";
export type EmailRedactionLevel = "strict" | "summary";
export type EmailRawBodyRetention = "none";
export type EmailAttachmentPolicy = "none" | "metadata_only";

export interface EmailImapProfileConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  login_method?: string;
  tls_reject_unauthorized: boolean;
}

export interface EmailProfileConfig {
  name: string;
  provider: EmailProvider;
  account_alias: string;
  secret_path?: string;
  folders: string[];
  allowed_senders: string[];
  subject_allowlist: string[];
  max_lookback_days: number;
  max_results: number;
  body_max_bytes: number;
  raw_body_retention: EmailRawBodyRetention;
  attachment_policy: EmailAttachmentPolicy;
  redaction: EmailRedactionLevel;
  state_path: string;
  imap?: EmailImapProfileConfig;
}

export interface EmailConfig {
  profiles: Record<string, EmailProfileConfig>;
}

export interface EmailSecret {
  username?: string;
  user?: string;
  password?: string;
  pass?: string;
  access_token?: string;
}

export interface EmailAddress {
  name?: string;
  address?: string;
}

export interface EmailAttachmentMeta {
  filename?: string;
  content_type?: string;
  size?: number;
  checksum?: string;
}

export interface EmailMessageRef {
  profile: string;
  folder: string;
  provider_uid: string;
}

export interface EmailQuery {
  profile: string;
  folders?: string[];
  from?: string[];
  subject_includes?: string[];
  received_after?: string;
  received_before?: string;
  max_results?: number;
  include_body?: boolean;
  include_attachments?: boolean;
}

export interface EmailMessage {
  id: string;
  profile: string;
  folder: string;
  provider_uid: string;
  message_id_hash: string;
  thread_id?: string;
  received_at: string;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  snippet?: string;
  text?: string;
  html?: string;
  attachments: EmailAttachmentMeta[];
}

export interface EmailSearchResult {
  profile: string;
  generated_at: string;
  query: {
    folders: string[];
    received_after?: string;
    received_before?: string;
    max_results: number;
  };
  messages: EmailMessage[];
  warnings: string[];
}

export interface EmailHealth {
  ok: boolean;
  provider: EmailProvider;
  account_alias: string;
  error?: string;
}

export interface EmailClient {
  healthCheck(): Promise<EmailHealth>;
  search(query: EmailQuery): Promise<EmailSearchResult>;
}

export interface EmailSeenMessageEntry {
  folder: string;
  provider_uid: string;
  message_id_hash: string;
  subject_hash?: string;
  received_at?: string;
  seen_at: string;
}

export interface EmailState {
  updated_at: string;
  provider_cursor: Record<string, unknown>;
  seen_messages: Record<string, EmailSeenMessageEntry>;
}

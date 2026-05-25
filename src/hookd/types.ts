export const CLI_SESSION_PROVIDERS = ["claude", "codex"] as const;
export type CliSessionProvider = typeof CLI_SESSION_PROVIDERS[number];

export const CLI_SESSION_PHASES = [
  "starting",
  "processing",
  "running_tool",
  "waiting_for_approval",
  "waiting_for_input",
  "compacting",
  "ended",
  "unknown",
] as const;
export type CliSessionPhase = typeof CLI_SESSION_PHASES[number];

export const CLI_SESSION_DASHBOARD_BUCKETS = [
  "approval",
  "active",
  "stale_active",
  "idle",
  "closed",
  "hidden",
] as const;
export type CliSessionDashboardBucket = typeof CLI_SESSION_DASHBOARD_BUCKETS[number];

export interface CliSessionHookEvent {
  provider: CliSessionProvider;
  providerSessionId: string;
  eventName: string;
  cwd: string;
  phase?: CliSessionPhase;
  pid?: number;
  tty?: string;
  terminalApp?: string;
  terminalSurface?: Record<string, unknown>;
  transcriptPath?: string;
  transcriptActivity?: boolean;
  prompt?: string;
  summary?: string;
  attentionKind?: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  approvalRequestId?: string;
  payload?: unknown;
  receivedAt?: Date;
}

export interface CliSessionRow {
  id: string;
  provider: CliSessionProvider;
  provider_session_id: string;
  cwd: string;
  pid: number | null;
  tty: string | null;
  terminal_app: string | null;
  terminal_surface_json: string | null;
  transcript_path: string | null;
  phase: CliSessionPhase;
  attention_kind: string | null;
  latest_summary: string | null;
  latest_prompt: string | null;
  last_event_name: string | null;
  last_activity_at: string;
  started_at: string;
  ended_at: string | null;
  hidden_at: string | null;
  observed_prompt_count: number;
  transcript_activity_at: string | null;
}

export interface CliSessionEventRow {
  id: string;
  cli_session_id: string;
  provider: CliSessionProvider;
  event_name: string;
  phase: CliSessionPhase;
  payload_json: string;
  created_at: string;
}

export const CLI_SESSION_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "denied",
  "timed_out",
  "expired",
  "ask",
] as const;
export type CliSessionApprovalStatus = typeof CLI_SESSION_APPROVAL_STATUSES[number];
export type CliSessionApprovalDecision = "allow" | "deny" | "ask";

export interface CliSessionApprovalRow {
  id: string;
  cli_session_id: string;
  provider: CliSessionProvider;
  provider_session_id: string;
  tool_name: string | null;
  tool_use_id: string | null;
  request_json: string;
  status: CliSessionApprovalStatus;
  decision_json: string | null;
  actor_id: string | null;
  requested_at: string;
  resolved_at: string | null;
  expires_at: string;
}

export interface CliSessionDashboardItem {
  session: CliSessionRow;
  bucket: CliSessionDashboardBucket;
  quietMs: number;
  priority: number;
}

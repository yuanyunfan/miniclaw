export type AgentProvider = "claude" | "codex";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexWebSearchMode = "disabled" | "cached" | "live";
export type ClaudeSettingSource = "user" | "project" | "local";
export type SmartRouterDefaultMode = "suggest" | "confirm" | "auto";
export type SmartRouterClassifierProvider = "auto" | "raven" | "anthropic" | "openai" | "openai_compatible" | "codex";
export type ModelClientId = SmartRouterClassifierProvider;
export type IMTransportId = "discord" | "feishu" | "weixin";
export interface IMRouteTargetConfig {
  transport: IMTransportId;
  target: string;
  accountId?: string;
  contextToken?: string;
}
export interface IMRouteConfig {
  targets: IMRouteTargetConfig[];
}
export type AudioTranscriptionProvider = "auto" | "openai" | "openai_compatible" | "local_faster_whisper";

export interface SmtpEmailNotificationConfig {
  enabled: boolean;
  smtpHost?: string;
  smtpPort: number;
  useSsl: boolean;
  username?: string;
  password?: string;
  from?: string;
  to?: string;
}

export type ConfigObject = Record<string, unknown>;
export type ConfigPath = readonly string[];
export type ConfigPathInput = ConfigPath | readonly ConfigPath[];

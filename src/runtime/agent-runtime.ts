import type { TaskViewEvent } from "../agent/task-view-events.js";

export type AgentRuntimeKind = "coding_agent";
export type AgentRuntimeTraceSeverity = "info" | "warning" | "error";

export interface AgentRuntimeCapabilities {
  resumeSession: boolean;
  cancel: boolean;
  toolEvents: boolean;
  workspaceWrite: boolean;
}

export interface AgentRuntimeTraceOptions {
  severity?: AgentRuntimeTraceSeverity;
  message?: string;
  payload?: unknown;
}

export interface AgentTaskAttachments {
  contentBlocks?: unknown[];
  inputEntries?: unknown[];
}

export interface AgentTaskMcpServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type AgentTaskManagedCodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type AgentTaskManagedCodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type AgentTaskManagedClaudePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";

export interface AgentTaskManagedRuntimePolicy {
  toolPolicyId: string;
  canWriteWorkspace: boolean;
  codex: {
    sandboxMode: AgentTaskManagedCodexSandboxMode;
    approvalPolicy: AgentTaskManagedCodexApprovalPolicy;
    denyDangerousCommands: boolean;
  };
  claude: {
    permissionMode: AgentTaskManagedClaudePermissionMode;
    allowedTools: string[];
    denyDangerousCommands: boolean;
    denyNativeSubagents: boolean;
    enforceWorkspaceWriteScope: boolean;
  };
}

export interface AgentTaskManagedContext {
  taskId: string;
  runId: string;
  role: string;
  rolePolicy?: AgentTaskManagedRuntimePolicy;
  agentBusMcp?: {
    serverName: string;
    serverConfig: AgentTaskMcpServerConfig;
    allowedTools: string[];
    promptBlock: string;
  };
}

export interface AgentTaskInput {
  taskId: string;
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  attachments?: AgentTaskAttachments;
  managedContext?: AgentTaskManagedContext;
  signal: AbortSignal;
  onViewEvent: (event: TaskViewEvent) => Promise<void> | void;
  onTraceEvent: (eventType: string, options?: AgentRuntimeTraceOptions) => void;
}

export interface AgentTaskResumeInput extends AgentTaskInput {
  resumeSessionId: string;
}

export interface AgentTaskResult {
  success: boolean;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  result: string;
  tokensSummary?: string;
  progressLines?: string[];
  toolCount?: number;
}

export interface AgentChatInput {
  channelId: string;
  userId: string;
  prompt: string;
  attachments?: AgentTaskAttachments;
  runtimeContext?: string;
  signal?: AbortSignal;
}

export interface AgentChatResult {
  reply: string;
  tokensSummary?: string;
}

export interface AgentRuntime {
  id: string;
  kind: AgentRuntimeKind;
  capabilities: AgentRuntimeCapabilities;
  startTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  resumeTask?(input: AgentTaskResumeInput): Promise<AgentTaskResult>;
  startChat?(input: AgentChatInput): Promise<AgentChatResult>;
}

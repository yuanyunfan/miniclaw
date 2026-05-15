import { isAbsolute, relative, resolve } from "node:path";
import type { AgentTaskManagedRuntimePolicy } from "../../runtime/agent-runtime.js";

export interface ManagedRuntimeRolePolicyInput {
  role: string;
  toolPolicyId: string;
  canWriteWorkspace: boolean;
}

export type ManagedClaudeToolUseDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

const CLAUDE_READ_ONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "mcp__exa__web_search_exa",
  "mcp__exa__get_code_context_exa",
  "mcp__context7__resolve-library-id",
  "mcp__context7__query-docs",
];

const CLAUDE_WORKSPACE_WRITE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Bash",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "mcp__exa__web_search_exa",
  "mcp__exa__get_code_context_exa",
  "mcp__context7__resolve-library-id",
  "mcp__context7__query-docs",
];

const WORKSPACE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const NATIVE_SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

const DANGEROUS_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\b(?:npm|pnpm|yarn)\s+publish\b/i,
  /\bgit\s+push\s+--force(?!-with-lease)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bchown\s+-R\b/i,
  /\brm\s+-[^\n;|&]*[rf][^\n;|&]*\s+(?:\/(?:\s|$)|~(?:\/|\s|$)|\.\.(?:\/|\s|$)|\.(?:\/|\s|$)|\*)/i,
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stringField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function recordInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

export function isDangerousManagedShellCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim();
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isPathInsideWorkspace(filePath: string, cwd: string): boolean {
  const base = resolve(cwd);
  const target = resolve(base, filePath);
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function buildManagedRuntimeRolePolicy(input: ManagedRuntimeRolePolicyInput): AgentTaskManagedRuntimePolicy {
  const canWriteWorkspace = input.canWriteWorkspace && input.toolPolicyId === "workspace-write";
  return {
    toolPolicyId: input.toolPolicyId,
    canWriteWorkspace,
    codex: {
      sandboxMode: canWriteWorkspace ? "workspace-write" : "read-only",
      approvalPolicy: "never",
      denyDangerousCommands: true,
    },
    claude: {
      permissionMode: canWriteWorkspace ? "acceptEdits" : "dontAsk",
      allowedTools: canWriteWorkspace ? [...CLAUDE_WORKSPACE_WRITE_TOOLS] : [...CLAUDE_READ_ONLY_TOOLS],
      denyDangerousCommands: true,
      denyNativeSubagents: true,
      enforceWorkspaceWriteScope: true,
    },
  };
}

export function managedRuntimePolicyEnv(policy: AgentTaskManagedRuntimePolicy): Record<string, string> {
  return {
    MINICLAW_AGENT_RUN_MANAGER_TOOL_POLICY_ID: policy.toolPolicyId,
    MINICLAW_AGENT_RUN_MANAGER_CAN_WRITE_WORKSPACE: policy.canWriteWorkspace ? "true" : "false",
    MINICLAW_AGENT_RUN_MANAGER_CODEX_SANDBOX: policy.codex.sandboxMode,
    MINICLAW_AGENT_RUN_MANAGER_CODEX_APPROVAL_POLICY: policy.codex.approvalPolicy,
    MINICLAW_AGENT_RUN_MANAGER_CLAUDE_PERMISSION_MODE: policy.claude.permissionMode,
  };
}

export function allowedClaudeToolsForManagedPolicy(
  policy: AgentTaskManagedRuntimePolicy,
  extraTools: string[] = [],
): string[] {
  return unique([...policy.claude.allowedTools, ...extraTools]);
}

export function evaluateManagedClaudeToolUse(input: {
  policy: AgentTaskManagedRuntimePolicy;
  cwd: string;
  toolName: string;
  toolInput: unknown;
}): ManagedClaudeToolUseDecision {
  const { policy, toolName, toolInput } = input;
  if (policy.claude.denyNativeSubagents && NATIVE_SUBAGENT_TOOLS.has(toolName)) {
    return {
      behavior: "deny",
      message: `Managed role policy ${policy.toolPolicyId} denies native ${toolName}; Agent Run Manager owns child scheduling.`,
    };
  }

  if (WORKSPACE_WRITE_TOOLS.has(toolName)) {
    if (!policy.canWriteWorkspace) {
      return {
        behavior: "deny",
        message: `Managed role policy ${policy.toolPolicyId} is read-only and cannot use ${toolName}.`,
      };
    }
    if (policy.claude.enforceWorkspaceWriteScope) {
      const filePath = stringField(toolInput, "file_path") ?? stringField(toolInput, "path");
      if (!filePath || !isPathInsideWorkspace(filePath, input.cwd)) {
        return {
          behavior: "deny",
          message: `Managed role policy ${policy.toolPolicyId} can only write inside the task workspace.`,
        };
      }
    }
  }

  if (toolName === "Bash") {
    if (!policy.canWriteWorkspace) {
      return {
        behavior: "deny",
        message: `Managed role policy ${policy.toolPolicyId} is read-only and cannot use Bash.`,
      };
    }
    const command = stringField(toolInput, "command") ?? "";
    if (policy.claude.denyDangerousCommands && isDangerousManagedShellCommand(command)) {
      return {
        behavior: "deny",
        message: `Bash command denied by managed role policy ${policy.toolPolicyId}: ${command.slice(0, 100)}`,
      };
    }
  }

  return { behavior: "allow", updatedInput: recordInput(toolInput) };
}

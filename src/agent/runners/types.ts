import type { TaskViewEvent } from "../task-view-events.js";
import type { TaskResult } from "../task.js";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { CodexInputEntry } from "../codex.js";
import type { AgentTaskManagedContext } from "../../runtime/agent-runtime.js";

export type TaskRunnerProvider = "claude" | "codex" | "fake";
export type TaskRunnerTraceSeverity = "info" | "warning" | "error";

export interface TaskRunnerTraceOptions {
  severity?: TaskRunnerTraceSeverity;
  message?: string;
  payload?: unknown;
}

export interface TaskRunnerResult extends TaskResult {
  progressLines?: string[];
  toolCount?: number;
}

export interface TaskRunnerInput {
  taskId: string;
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  attachmentBlocks?: ContentBlockParam[];
  attachmentCodexInputs?: CodexInputEntry[];
  managedContext?: AgentTaskManagedContext;
  signal: AbortSignal;
  onViewEvent: (event: TaskViewEvent) => Promise<void> | void;
  onTraceEvent: (eventType: string, options?: TaskRunnerTraceOptions) => void;
}

export interface TaskRunner {
  provider: TaskRunnerProvider;
  run(input: TaskRunnerInput): Promise<TaskRunnerResult>;
}

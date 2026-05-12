import type { TaskViewEvent } from "../task-view-events.js";
import type { TaskResult } from "../task.js";

export type TaskRunnerProvider = "claude" | "codex" | "fake";

export interface TaskRunnerInput {
  taskId: string;
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  signal: AbortSignal;
  onViewEvent: (event: TaskViewEvent) => Promise<void> | void;
  onTraceEvent: (eventType: string, payload?: unknown) => void;
}

export interface TaskRunner {
  provider: TaskRunnerProvider;
  run(input: TaskRunnerInput): Promise<TaskResult>;
}

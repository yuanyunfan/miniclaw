import type { TaskResult } from "./task.js";
import type { TaskViewEvent } from "./task-view-events.js";

export type TaskTerminalStatus = "completed" | "failed" | "cancelled" | "interrupted";

export interface TaskViewProgressSnapshot {
  lines: string[];
  turns: number;
  toolCount: number;
}

export interface TaskViewReporter {
  start(): Promise<void>;
  handle(event: TaskViewEvent): Promise<void>;
  snapshot(): TaskViewProgressSnapshot;
  finish(
    result: TaskResult,
    status: TaskTerminalStatus,
    progressSnapshot?: Partial<Pick<TaskViewProgressSnapshot, "lines" | "toolCount">>,
  ): Promise<void>;
  renderTaskError(message: string): Promise<void>;
}

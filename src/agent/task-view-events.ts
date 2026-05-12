import type { TaskResult } from "./task.js";

export type TaskViewEventSeverity = "info" | "warning" | "error";

export interface TaskStartedViewEvent {
  type: "task_started";
  taskId: string;
  provider: string;
  model?: string;
  cwd: string;
}

export interface SessionStartedViewEvent {
  type: "session_started";
  provider: string;
  sessionId: string;
}

export interface TurnStartedViewEvent {
  type: "turn_started";
  provider: string;
  turn: number;
}

export interface ToolProgressViewEvent {
  type: "tool_progress";
  provider: string;
  title: string;
  detail?: string;
  severity?: TaskViewEventSeverity;
}

export interface AssistantProgressViewEvent {
  type: "assistant_progress";
  provider: string;
  text: string;
}

export interface ProviderErrorViewEvent {
  type: "provider_error";
  provider: string;
  message: string;
  errorType?: string;
}

export interface TaskCompletedViewEvent {
  type: "task_completed";
  result: TaskResult;
}

export interface TaskFailedViewEvent {
  type: "task_failed";
  message: string;
  errorType?: string;
}

export type TaskViewEvent =
  | TaskStartedViewEvent
  | SessionStartedViewEvent
  | TurnStartedViewEvent
  | ToolProgressViewEvent
  | AssistantProgressViewEvent
  | ProviderErrorViewEvent
  | TaskCompletedViewEvent
  | TaskFailedViewEvent;

export const TASK_VIEW_TEXT_MAX = 1000;

export interface RedactTaskViewTextOptions {
  maxChars?: number;
}

const AUTHORIZATION_PATTERN = /\b(authorization\s*[:=]\s*)(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|token|secret|password|pwd)\b(\s*[:=]\s*)(["']?)[^\s"',;]+["']?/gi;
const STANDALONE_BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g;

export function redactTaskViewText(text: string, options: RedactTaskViewTextOptions = {}): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(AUTHORIZATION_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string, separator: string, quote: string) => {
      const q = quote || "";
      return `${key}${separator}${q}[REDACTED]${q}`;
    })
    .replace(STANDALONE_BEARER_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(KNOWN_TOKEN_PATTERN, "[REDACTED]");

  const maxChars = options.maxChars;
  if (maxChars === undefined || redacted.length <= maxChars) return redacted;
  if (maxChars <= 3) return redacted.slice(0, Math.max(0, maxChars));
  return `${redacted.slice(0, maxChars - 3)}...`;
}

function requiredText(text: string, fallback: string, options: RedactTaskViewTextOptions = { maxChars: TASK_VIEW_TEXT_MAX }): string {
  return redactTaskViewText(text, options) || fallback;
}

function optionalText(text: string | undefined, options: RedactTaskViewTextOptions = { maxChars: TASK_VIEW_TEXT_MAX }): string | undefined {
  if (text === undefined) return undefined;
  return redactTaskViewText(text, options) || undefined;
}

function redactedResult(result: TaskResult): TaskResult {
  return {
    ...result,
    result: requiredText(result.result, result.success ? "[no text reply]" : "task failed without details", {}),
  };
}

export const taskViewEvents = {
  taskStarted(params: { taskId: string; provider: string; model?: string; cwd: string }): TaskStartedViewEvent {
    return {
      type: "task_started",
      taskId: params.taskId,
      provider: params.provider,
      ...(params.model ? { model: params.model } : {}),
      cwd: params.cwd,
    };
  },

  sessionStarted(provider: string, sessionId: string): SessionStartedViewEvent {
    return { type: "session_started", provider, sessionId };
  },

  turnStarted(provider: string, turn: number): TurnStartedViewEvent {
    return { type: "turn_started", provider, turn };
  },

  toolProgress(params: {
    provider: string;
    title: string;
    detail?: string;
    severity?: TaskViewEventSeverity;
  }): ToolProgressViewEvent {
    const detail = optionalText(params.detail);
    return {
      type: "tool_progress",
      provider: params.provider,
      title: requiredText(params.title, "tool activity"),
      ...(detail ? { detail } : {}),
      ...(params.severity ? { severity: params.severity } : {}),
    };
  },

  assistantProgress(provider: string, text: string): AssistantProgressViewEvent {
    return {
      type: "assistant_progress",
      provider,
      text: requiredText(text, "assistant progress"),
    };
  },

  providerError(provider: string, message: string, errorType?: string): ProviderErrorViewEvent {
    const cleanErrorType = optionalText(errorType);
    return {
      type: "provider_error",
      provider,
      message: requiredText(message, "provider error", { maxChars: TASK_VIEW_TEXT_MAX }),
      ...(cleanErrorType ? { errorType: cleanErrorType } : {}),
    };
  },

  taskCompleted(result: TaskResult): TaskCompletedViewEvent {
    return { type: "task_completed", result: redactedResult(result) };
  },

  taskFailed(message: string, errorType?: string): TaskFailedViewEvent {
    const cleanErrorType = optionalText(errorType);
    return {
      type: "task_failed",
      message: requiredText(message, "task failed", { maxChars: TASK_VIEW_TEXT_MAX }),
      ...(cleanErrorType ? { errorType: cleanErrorType } : {}),
    };
  },
} as const;

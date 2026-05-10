import { createLogger } from "../lib/log.js";
import { appendTaskEvent, type TaskEventSeverity } from "../store/task-events.js";

const log = createLogger("task-reporter");

function compactMessage(message: string | undefined, max = 500): string | undefined {
  if (!message) return undefined;
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

export class TaskReporter {
  constructor(private readonly taskId: string) {}

  event(
    eventType: string,
    options: { severity?: TaskEventSeverity; message?: string; payload?: unknown } = {}
  ): void {
    try {
      appendTaskEvent({
        taskId: this.taskId,
        eventType,
        severity: options.severity,
        message: compactMessage(options.message),
        payload: options.payload,
      });
    } catch (err) {
      log.warn(`failed to persist task event ${eventType} for ${this.taskId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  started(payload: Record<string, unknown>): void {
    this.event("task_started", { payload });
  }

  accepted(payload: Record<string, unknown>): void {
    this.event("task_accepted", { payload });
  }

  contextCaptured(payload: Record<string, unknown>): void {
    this.event("task_context_captured", { payload });
  }

  sessionStarted(sessionId: string, provider: string): void {
    this.event("session_started", { message: sessionId, payload: { provider, session_id: sessionId } });
  }

  turnStarted(turn: number, provider: string): void {
    this.event("turn_started", { payload: { provider, turn } });
  }

  turnCompleted(turn: number, provider: string, payload?: unknown): void {
    this.event("turn_completed", { payload: { provider, turn, usage: payload } });
  }

  toolEvent(provider: string, message: string, payload?: unknown): void {
    this.event("tool_event", { message, payload: { provider, ...asRecord(payload) } });
  }

  providerError(provider: string, message: string, payload?: unknown): void {
    this.event("provider_error", { severity: "error", message, payload: { provider, ...asRecord(payload) } });
  }

  discordDeliveryFailed(operation: string, err: unknown): void {
    this.event("discord_delivery_failed", {
      severity: "warning",
      message: err instanceof Error ? err.message : String(err),
      payload: { operation },
    });
  }

  finished(status: string, payload: Record<string, unknown>): void {
    this.event(status === "completed" ? "task_completed" : "task_finished", {
      severity: status === "completed" ? "info" : "warning",
      message: status,
      payload,
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

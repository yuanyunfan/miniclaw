import { beforeAll, describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";
import { createTask, initDb, updateTask } from "../db.js";
import { appendTaskEvent } from "../task-events.js";
import {
  __testables,
  buildTaskTraceModel,
  redactTaskTraceText,
  renderTaskTraceMarkdown,
  resolveTaskForTrace,
} from "../task-trace-export.js";

beforeAll(() => {
  initDb();
});

function makeTask(id = uuid()): string {
  createTask({
    id,
    discord_thread_id: "thread-" + id.slice(0, 8),
    discord_user_id: "user-1",
    prompt: "full prompt must not be exported",
    cwd: "/tmp/task-trace",
    source_route_type: "slash_command",
    source_channel_id: "channel-123",
    source_message_id: "message-123",
    source_message_url: "https://discord.com/channels/g/c/m",
  });
  return id;
}

describe("resolveTaskForTrace", () => {
  it("returns explicit errors for missing, unknown, and ambiguous ids", () => {
    expect(resolveTaskForTrace("")).toMatchObject({
      ok: false,
      error: { code: "missing_id" },
    });

    expect(resolveTaskForTrace("does-not-exist")).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });

    const prefix = `trace-${uuid().slice(0, 8)}`;
    makeTask(`${prefix}-a`);
    makeTask(`${prefix}-b`);

    const result = resolveTaskForTrace(prefix);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ambiguous_prefix" },
    });
    if (!result.ok) expect(result.error.matches).toHaveLength(2);
  });

  it("resolves exact ids and unique prefixes", () => {
    const id = makeTask(`trace-${uuid()}`);
    expect(resolveTaskForTrace(id)).toMatchObject({ ok: true, value: { id } });
    expect(resolveTaskForTrace(id.slice(0, 14))).toMatchObject({ ok: true, value: { id } });
  });
});

describe("task trace export", () => {
  it("returns no_events before exporting an empty task", () => {
    const id = makeTask();
    expect(buildTaskTraceModel(id)).toMatchObject({
      ok: false,
      error: { code: "no_events" },
    });
  });

  it("builds chronological sanitized trace events without raw prompt or secret payload keys", () => {
    const id = makeTask();
    updateTask(id, {
      status: "failed",
      session_id: "codex:session-1",
      duration_ms: 1250,
      completed_at: new Date().toISOString(),
    });

    appendTaskEvent({
      taskId: id,
      eventType: "task_started",
      payload: {
        provider: "codex",
        model: "gpt-test",
        cwd: "/tmp/task-trace",
        prompt: "do not export this prompt",
      },
    });
    appendTaskEvent({
      taskId: id,
      eventType: "session_started",
      message: "codex:session-1",
      payload: {
        provider: "codex",
        session_id: "codex:session-1",
      },
    });
    appendTaskEvent({
      taskId: id,
      eventType: "provider_error",
      severity: "error",
      message: "Authorization: Bearer secret-token-123456 email_body: private email body",
      payload: {
        provider: "codex",
        event_type: "turn.failed",
        token: "secret-token-123456",
        prompt: "raw prompt payload",
      },
    });

    const result = buildTaskTraceModel(id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.task.sessionId).toMatch(/^\[redacted-session:[a-f0-9]{12}\]$/);
    expect(result.value.events.map((event) => event.eventType)).toEqual(["task_started", "session_started", "provider_error"]);
    expect(result.value.events[0]?.payload).toMatchObject({ provider: "codex", model: "gpt-test" });
    expect(result.value.events[0]?.redactedPayloadKeys).toBe(1);
    expect(result.value.events[1]?.message).toMatch(/^\[redacted-session:[a-f0-9]{12}\]$/);
    expect(result.value.events[1]?.payload.session_id).toMatch(/^\[redacted-session:[a-f0-9]{12}\]$/);
    expect(result.value.events[2]?.message).toContain("Authorization: [REDACTED]");
    expect(result.value.events[2]?.message).toContain("email_body: [REDACTED]");
    expect(result.value.events[2]?.payload).toEqual({ provider: "codex", event_type: "turn.failed" });
    expect(result.value.events[2]?.redactedPayloadKeys).toBe(2);

    const markdown = renderTaskTraceMarkdown(result.value);
    expect(markdown).toContain("# Task Trace:");
    expect(markdown).toContain("- prompt: [redacted]");
    expect(markdown).not.toContain("do not export this prompt");
    expect(markdown).not.toContain("codex:session-1");
    expect(markdown).not.toContain("secret-token-123456");
    expect(markdown).not.toContain("private email body");
  });

  it("keeps allowed token usage fields and omits raw usage detail keys", () => {
    const projected = __testables.projectPayload("turn_completed", {
      provider: "codex",
      turn: 2,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        raw_response: { token: "secret" },
      },
    }, 200);

    expect(projected).toEqual({
      payload: {
        provider: "codex",
        turn: 2,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
        },
      },
      redactedPayloadKeys: 1,
    });
  });

  it("redacts common credential shapes and caps markdown bytes", () => {
    expect(redactTaskTraceText("Cookie: a=b; token=abc123 Authorization: Bearer abcdefghijklmnop sk-1234567890abcdef account_number=123456789012"))
      .toBe("Cookie: [REDACTED]; token=[REDACTED] Authorization: [REDACTED] [REDACTED] account_number=[REDACTED]");

    const id = makeTask();
    appendTaskEvent({ taskId: id, eventType: "tool_event", message: "x".repeat(5000), payload: { provider: "codex" } });
    const model = buildTaskTraceModel(id);
    if (!model.ok) throw new Error(model.error.message);
    const markdown = renderTaskTraceMarkdown(model.value, { maxBytes: 500 });
    expect(Buffer.byteLength(markdown, "utf8")).toBeLessThanOrEqual(500);
    expect(markdown).toContain("Trace truncated by max_bytes limit");
  });
});

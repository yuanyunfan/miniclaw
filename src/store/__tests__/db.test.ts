import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuid } from "uuid";
import {
  SCHEMA_VERSION,
  initDb,
  createTask,
  getTask,
  getTaskByThreadId,
  updateTask,
  markTaskInterrupted,
  getInterruptedTasks,
  getSchemaVersion,
  listSchemaVersionHistory,
  listSmartRouterReviewRows,
  recordSmartRouterDecision,
  recordSmartRouterUserChoice,
  updateSmartRouterDecision,
  getRecentSmartRouterDecisions,
  __testables,
} from "../db.js";
import {
  addChatMessage as addChatMessageFromRepository,
  getChatHistory as getChatHistoryFromRepository,
} from "../repositories/chat-history.js";
import {
  getRecentSmartRouterDecisions as getRecentSmartRouterDecisionsFromRepository,
  listSmartRouterReviewRows as listSmartRouterReviewRowsFromRepository,
  recordSmartRouterDecision as recordSmartRouterDecisionFromRepository,
} from "../repositories/smart-router-decisions.js";
import {
  createTask as createTaskFromRepository,
  getTask as getTaskFromRepository,
  updateTask as updateTaskFromRepository,
} from "../repositories/tasks.js";

beforeAll(() => {
  initDb();
});

afterAll(() => {
  // tmp dir cleanup is OS responsibility; we just disconnect.
});

function makeTask(threadId = "thread-" + uuid().slice(0, 8)) {
  const id = uuid();
  createTask({
    id,
    discord_thread_id: threadId,
    discord_user_id: "u-1",
    prompt: "test prompt",
    cwd: "/tmp",
  });
  return { id, threadId };
}

describe("createTask + getTask", () => {
  it("inserts and retrieves a task", () => {
    const { id } = makeTask();
    const row = getTask(id);
    expect(row).toBeDefined();
    expect(row?.prompt).toBe("test prompt");
    expect(row?.status).toBe("running");
  });

  it("returns undefined for unknown id", () => {
    expect(getTask("nonexistent-id")).toBeUndefined();
  });

  it("persists optional source metadata and parent context", () => {
    const id = uuid();
    const source = {
      provider: "discord",
      route_type: "task_channel",
      source_channel_id: "channel-1",
      source_message_id: "message-1",
    };
    const parent = {
      kind: "reply",
      provider: "discord",
      message_id: "parent-1",
      content: "parent message",
    };
    createTask({
      id,
      discord_thread_id: "thread-context",
      discord_user_id: "u-1",
      prompt: "test prompt",
      cwd: "/tmp",
      source_route_type: "task_channel",
      source_channel_id: "channel-1",
      source_message_id: "message-1",
      source_message_url: "https://discord.com/channels/guild/channel/message",
      source_metadata_json: JSON.stringify(source),
      parent_context_json: JSON.stringify(parent),
    });

    const row = getTask(id);
    expect(row?.source_route_type).toBe("task_channel");
    expect(row?.source_channel_id).toBe("channel-1");
    expect(row?.source_message_id).toBe("message-1");
    expect(row?.source_message_url).toContain("discord.com");
    expect(JSON.parse(row?.source_metadata_json ?? "{}")).toMatchObject(source);
    expect(JSON.parse(row?.parent_context_json ?? "{}")).toMatchObject(parent);
  });
});

describe("schema migrations", () => {
  it("sets SQLite user_version to current schema version", () => {
    expect(getSchemaVersion()).toBe(SCHEMA_VERSION);
  });

  it("records schema migration history", () => {
    const history = listSchemaVersionHistory();
    expect(history.at(-1)?.to_version).toBe(SCHEMA_VERSION);
    expect(new Set(history.map((row) => row.to_version)).size).toBe(history.length);
  });

  it("ensures progress_message_id column exists", () => {
    expect(__testables.columnExists("tasks", "progress_message_id")).toBe(true);
  });

  it("ensures schema version history table exists", () => {
    expect(__testables.columnExists("schema_version_history", "from_version")).toBe(true);
    expect(__testables.columnExists("schema_version_history", "migration_name")).toBe(true);
    expect(__testables.columnExists("schema_version_history", "applied_at")).toBe(true);
  });

  it("ensures smart router decisions table exists", () => {
    expect(__testables.columnExists("smart_router_decisions", "prompt_hash")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "action_result")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "capabilities_json")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "classifier_elapsed_ms")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "classifier_error_type")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "classifier_error_message")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "user_choice")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "final_route")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "task_final_status")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "correction_type")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "correction_note")).toBe(true);
    expect(__testables.columnExists("smart_router_decisions", "resolved_at")).toBe(true);
  });

  it("ensures task source context columns exist", () => {
    expect(__testables.columnExists("tasks", "source_route_type")).toBe(true);
    expect(__testables.columnExists("tasks", "source_channel_id")).toBe(true);
    expect(__testables.columnExists("tasks", "source_message_id")).toBe(true);
    expect(__testables.columnExists("tasks", "source_message_url")).toBe(true);
    expect(__testables.columnExists("tasks", "source_metadata_json")).toBe(true);
    expect(__testables.columnExists("tasks", "parent_context_json")).toBe(true);
  });

  it("ensures doctor incident tables exist", () => {
    expect(__testables.columnExists("incidents", "dedupe_key")).toBe(true);
    expect(__testables.columnExists("incident_events", "event_type")).toBe(true);
    expect(__testables.columnExists("repair_runs", "incident_id")).toBe(true);
  });

  it("ensures normalized task event table exists", () => {
    expect(__testables.columnExists("task_events", "task_id")).toBe(true);
    expect(__testables.columnExists("task_events", "event_type")).toBe(true);
    expect(__testables.columnExists("task_events", "payload_json")).toBe(true);
  });

  it("ensures market forecast persistence tables exist", () => {
    expect(__testables.columnExists("market_forecasts", "payload_json")).toBe(true);
    expect(__testables.columnExists("market_forecasts", "report_text")).toBe(true);
    expect(__testables.columnExists("market_forecast_items", "forecast_id")).toBe(true);
    expect(__testables.columnExists("market_forecast_items", "source")).toBe(true);
    expect(__testables.columnExists("market_forecast_evaluations", "score_json")).toBe(true);
  });

  it("ensures cron run history table exists", () => {
    expect(__testables.columnExists("cron_runs", "job_name")).toBe(true);
    expect(__testables.columnExists("cron_runs", "status")).toBe(true);
    expect(__testables.columnExists("cron_runs", "task_id")).toBe(true);
    expect(__testables.columnExists("cron_runs", "metadata_json")).toBe(true);
  });

  it("ensures recovery outbox table exists", () => {
    expect(__testables.columnExists("recovery_outbox", "kind")).toBe(true);
    expect(__testables.columnExists("recovery_outbox", "channel_id")).toBe(true);
    expect(__testables.columnExists("recovery_outbox", "payload_json")).toBe(true);
  });
});

describe("updateTask", () => {
  it("updates allowed fields", () => {
    const { id } = makeTask();
    updateTask(id, { session_id: "sess-abc", status: "completed", cost_usd: 0.42 });
    const row = getTask(id);
    expect(row?.session_id).toBe("sess-abc");
    expect(row?.status).toBe("completed");
    expect(row?.cost_usd).toBe(0.42);
  });
});

describe("getTaskByThreadId", () => {
  it("returns most recent task with session_id for thread", () => {
    const threadId = "thread-multi-" + uuid().slice(0, 6);
    const t1 = makeTask(threadId);
    updateTask(t1.id, { session_id: "sess-old" });
    const t2 = makeTask(threadId);
    updateTask(t2.id, { session_id: "sess-new" });
    const row = getTaskByThreadId(threadId);
    expect(row).toBeDefined();
    expect(row?.session_id).toBe("sess-new");
  });

  it("ignores tasks without session_id", () => {
    const threadId = "thread-nosess-" + uuid().slice(0, 6);
    makeTask(threadId); // no session_id assigned
    expect(getTaskByThreadId(threadId)).toBeUndefined();
  });

  it("returns undefined for unknown thread", () => {
    expect(getTaskByThreadId("never-existed")).toBeUndefined();
  });
});

describe("markTaskInterrupted + getInterruptedTasks", () => {
  it("flips status from running to interrupted", () => {
    const { id } = makeTask();
    markTaskInterrupted(id, "shutdown drain timeout");
    expect(getTask(id)?.status).toBe("interrupted");
    expect(getTask(id)?.result_summary).toBe("shutdown drain timeout");
    const interrupted = getInterruptedTasks(20);
    expect(interrupted.some((t) => t.id === id)).toBe(true);
  });
});

describe("smart router decisions", () => {
  it("records redacted decisions and updates action result", () => {
    const id = recordSmartRouterDecision({
      message_id: "msg-1",
      channel_id: "ch-1",
      user_id: "user-1",
      prompt_hash: "hash-1",
      prompt_preview: "修复 README 并跑测试",
      intent: "task_confirm",
      confidence: 0.88,
      reason: "strong task signal",
      matched_signals: ["modify", "validation"],
      risk_flags: ["writes_files", "runs_tests"],
      capabilities_json: JSON.stringify({
        needsFileWrite: true,
        needsShell: true,
        classifierElapsedMs: 30012,
        classifierErrorType: "timeout",
        classifierErrorMessage: "Codex timeout after 30000ms",
      }),
      classifier_elapsed_ms: 30012,
      classifier_error_type: "timeout",
      classifier_error_message: "Codex timeout after 30000ms",
      action_result: "confirmation_pending",
    });

    updateSmartRouterDecision(id, {
      action_result: "confirmed_task_created",
      created_task_id: "task-1",
    });

    const row = getRecentSmartRouterDecisions(5).find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row?.prompt_preview).toBe("修复 README 并跑测试");
    expect(row?.full_prompt).toBeNull();
    expect(row?.action_result).toBe("confirmed_task_created");
    expect(row?.created_task_id).toBe("task-1");
    expect(row?.classifier_elapsed_ms).toBe(30012);
    expect(row?.classifier_error_type).toBe("timeout");
    expect(row?.classifier_error_message).toBe("Codex timeout after 30000ms");
    expect(JSON.parse(row?.matched_signals ?? "[]")).toEqual(["modify", "validation"]);
    expect(JSON.parse(row?.capabilities_json ?? "{}")).toMatchObject({
      needsFileWrite: true,
      needsShell: true,
      classifierElapsedMs: 30012,
      classifierErrorType: "timeout",
    });
  });

  it("records user choice fields for confirmation outcomes", () => {
    const id = recordSmartRouterDecision({
      message_id: "msg-choice",
      channel_id: "ch-choice",
      user_id: "user-choice",
      prompt_hash: "hash-choice",
      intent: "task_suggest",
      confidence: 0.7,
      action_result: "confirmation_pending",
    });

    recordSmartRouterUserChoice(id, "continued_chat", "chat", {
      action_result: "continued_chat",
      task_final_status: "not_created",
      correction_type: "user_override",
      correction_note: "user chose chat from smart router confirmation",
    });

    const row = getRecentSmartRouterDecisions(10).find((r) => r.id === id);
    expect(row).toMatchObject({
      user_choice: "continued_chat",
      final_route: "chat",
      task_final_status: "not_created",
      correction_type: "user_override",
      correction_note: "user chose chat from smart router confirmation",
      action_result: "continued_chat",
    });
    expect(row?.resolved_at).toBeTruthy();
  });

  it("links created smart-router tasks to final task outcome and review rows", () => {
    const { id: taskId } = makeTask();
    const decisionId = recordSmartRouterDecision({
      message_id: "msg-task-outcome",
      channel_id: "ch-task-outcome",
      user_id: "user-task-outcome",
      prompt_hash: "hash-task-outcome",
      intent: "task_confirm",
      confidence: 0.9,
      action_result: "confirmed_task_created",
      created_task_id: taskId,
      user_choice: "accepted_task",
      final_route: "task",
      correction_type: "none",
    });

    updateTask(taskId, { status: "failed", completed_at: new Date().toISOString() });

    const row = getRecentSmartRouterDecisions(10).find((r) => r.id === decisionId);
    expect(row?.task_final_status).toBe("failed");
    expect(row?.final_route).toBe("task");
    expect(row?.resolved_at).toBeTruthy();

    const review = listSmartRouterReviewRows({ channelId: "ch-task-outcome", limit: 5 });
    expect(review[0]).toMatchObject({
      id: decisionId,
      created_task_id: taskId,
      task_final_status: "failed",
      linked_task_status: "failed",
    });
  });
});

describe("store repositories", () => {
  it("keeps direct task repository status updates linked to Smart Router outcomes", () => {
    const taskId = uuid();
    createTaskFromRepository({
      id: taskId,
      discord_thread_id: `thread-repository-${uuid().slice(0, 8)}`,
      discord_user_id: "user-repository",
      prompt: "repository test prompt",
      cwd: "/tmp",
    });
    const decisionId = recordSmartRouterDecisionFromRepository({
      message_id: `message-${uuid()}`,
      channel_id: "repository-router-channel",
      user_id: "user-repository",
      prompt_hash: `hash-${uuid()}`,
      intent: "task_confirm",
      confidence: 0.91,
      action_result: "confirmed_task_created",
      created_task_id: taskId,
      user_choice: "accepted_task",
      final_route: "task",
      correction_type: "none",
    });

    updateTaskFromRepository(taskId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      result_summary: "done",
    });

    expect(getTaskFromRepository(taskId)).toMatchObject({
      status: "completed",
      result_summary: "done",
    });
    expect(getRecentSmartRouterDecisionsFromRepository(20).find((row) => row.id === decisionId)).toMatchObject({
      task_final_status: "completed",
      final_route: "task",
      correction_type: "none",
    });
    expect(listSmartRouterReviewRowsFromRepository({ channelId: "repository-router-channel", limit: 5 })[0]).toMatchObject({
      id: decisionId,
      created_task_id: taskId,
      linked_task_status: "completed",
    });
  });

  it("stores direct chat repository history per channel in newest-first order", () => {
    const channelId = `repository-chat-${uuid()}`;
    addChatMessageFromRepository(channelId, "user-repository", "user", "first prompt");
    addChatMessageFromRepository(channelId, "assistant", "assistant", "assistant reply");
    addChatMessageFromRepository(`other-${channelId}`, "user-repository", "user", "other channel");

    expect(getChatHistoryFromRepository(channelId, 5)).toEqual([
      { role: "assistant", content: "assistant reply" },
      { role: "user", content: "first prompt" },
    ]);
  });
});

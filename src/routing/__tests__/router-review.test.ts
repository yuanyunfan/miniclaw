import { describe, expect, it } from "vitest";
import type { SmartRouterReviewRow } from "../../store/db.js";
import { renderSmartRouterReview, summarizeSmartRouterReview } from "../router-review.js";

function row(overrides: Partial<SmartRouterReviewRow>): SmartRouterReviewRow {
  return {
    id: 1,
    message_id: "msg-1",
    channel_id: "ch-1",
    user_id: "user-1",
    prompt_hash: "abcdef1234567890",
    prompt_preview: "do not render this prompt",
    full_prompt: null,
    intent: "task_confirm",
    confidence: 0.9,
    reason: "test",
    matched_signals: "[]",
    risk_flags: "[]",
    capabilities_json: null,
    classifier_elapsed_ms: null,
    classifier_error_type: null,
    classifier_error_message: null,
    action_result: "confirmed_task_created",
    created_task_id: "task-1",
    user_choice: "accepted_task",
    final_route: "task",
    task_final_status: "completed",
    correction_type: "none",
    correction_note: null,
    resolved_at: "2026-05-12T00:01:00.000Z",
    created_at: "2026-05-12 00:00:00",
    linked_task_status: "completed",
    ...overrides,
  };
}

describe("smart router review report", () => {
  it("summarizes quality dimensions and omits prompt preview text from rendering", () => {
    const rows = [
      row({ id: 1, final_route: "task", task_final_status: "completed", user_choice: "accepted_task" }),
      row({
        id: 2,
        channel_id: "ch-2",
        intent: "task_suggest",
        action_result: "continued_chat",
        created_task_id: null,
        user_choice: "continued_chat",
        final_route: "chat",
        task_final_status: "not_created",
        correction_type: "user_override",
        linked_task_status: null,
      }),
      row({
        id: 3,
        classifier_error_type: "timeout",
        action_result: "chat",
        created_task_id: null,
        user_choice: null,
        final_route: "chat",
        task_final_status: "not_created",
        linked_task_status: null,
      }),
    ];

    const summary = summarizeSmartRouterReview(rows, { since: "2026-05-05T00:00:00.000Z" }, "2026-05-12T00:00:00.000Z");
    expect(summary.total).toBe(3);
    expect(summary.byFinalRoute).toContainEqual({ key: "chat", count: 2 });
    expect(summary.byUserChoice).toContainEqual({ key: "continued_chat", count: 1 });
    expect(summary.byClassifierError).toContainEqual({ key: "timeout", count: 1 });
    expect(JSON.stringify(summary)).not.toContain("do not render this prompt");

    const rendered = renderSmartRouterReview(summary);
    expect(rendered).toContain("Smart Router review");
    expect(rendered).toContain("By task outcome");
    expect(rendered).toContain("hash=abcdef123456");
    expect(rendered).not.toContain("do not render this prompt");
  });
});

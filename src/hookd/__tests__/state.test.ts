import { describe, expect, it } from "vitest";
import {
  classifyCliSessionForDashboard,
  mapHookEventToPhase,
  sortCliSessionsForDashboard,
} from "../state.js";
import type { CliSessionRow } from "../types.js";

function row(overrides: Partial<CliSessionRow>): CliSessionRow {
  return {
    id: "session-1",
    provider: "claude",
    provider_session_id: "provider-session-1",
    cwd: "/repo",
    pid: 123,
    tty: "ttys001",
    terminal_app: "iTerm.app",
    terminal_surface_json: null,
    transcript_path: null,
    phase: "processing",
    attention_kind: null,
    latest_summary: null,
    latest_prompt: null,
    last_event_name: "UserPromptSubmit",
    last_activity_at: "2026-05-25T00:00:00.000Z",
    started_at: "2026-05-25T00:00:00.000Z",
    ended_at: null,
    hidden_at: null,
    observed_prompt_count: 1,
    transcript_activity_at: null,
    ...overrides,
  };
}

describe("hookd state mapping", () => {
  it("maps provider hook events into canonical phases", () => {
    expect(mapHookEventToPhase("claude", "UserPromptSubmit")).toBe("processing");
    expect(mapHookEventToPhase("claude", "PreToolUse")).toBe("running_tool");
    expect(mapHookEventToPhase("claude", "PermissionRequest")).toBe("waiting_for_approval");
    expect(mapHookEventToPhase("claude", "Stop")).toBe("waiting_for_input");
    expect(mapHookEventToPhase("codex", "SessionEnd")).toBe("ended");
  });

  it("keeps active sessions above newer idle sessions", () => {
    const items = sortCliSessionsForDashboard([
      row({
        id: "idle-new",
        phase: "waiting_for_input",
        last_activity_at: "2026-05-25T00:10:00.000Z",
      }),
      row({
        id: "active-old",
        phase: "processing",
        last_activity_at: "2026-05-25T00:00:00.000Z",
      }),
    ], {
      now: new Date("2026-05-25T00:11:00.000Z"),
      staleActiveMs: 30 * 60 * 1000,
    });

    expect(items.map((item) => item.session.id)).toEqual(["active-old", "idle-new"]);
  });

  it("labels quiet active sessions as stale active", () => {
    const item = classifyCliSessionForDashboard(row({
      phase: "processing",
      last_activity_at: "2026-05-25T00:00:00.000Z",
    }), new Date("2026-05-25T00:20:00.000Z"), 15 * 60 * 1000);

    expect(item.bucket).toBe("stale_active");
  });

  it("hides empty Codex startup sessions from the default dashboard", () => {
    const items = sortCliSessionsForDashboard([
      row({
        id: "codex-empty",
        provider: "codex",
        phase: "starting",
        observed_prompt_count: 0,
        transcript_activity_at: null,
      }),
    ]);

    expect(items).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildCliSessionContinueModalId,
  buildCliSessionCustomId,
  buildCliSessionDashboardMessage,
  parseCliSessionContinueModalId,
  parseCliSessionCustomId,
} from "../cli-session-dashboard.js";
import type { CliSessionApprovalRow, CliSessionRow } from "../../hookd/types.js";

function session(overrides: Partial<CliSessionRow>): CliSessionRow {
  return {
    id: "session-12345678",
    provider: "claude",
    provider_session_id: "provider-session-1",
    cwd: "/repo",
    pid: 123,
    tty: "ttys001",
    terminal_app: "iTerm.app",
    terminal_surface_json: null,
    transcript_path: null,
    phase: "waiting_for_input",
    attention_kind: null,
    latest_summary: null,
    latest_prompt: "next step",
    last_event_name: "Stop",
    last_activity_at: "2026-05-25T00:00:00.000Z",
    started_at: "2026-05-25T00:00:00.000Z",
    ended_at: null,
    hidden_at: null,
    observed_prompt_count: 1,
    transcript_activity_at: null,
    ...overrides,
  };
}

function approval(overrides: Partial<CliSessionApprovalRow> = {}): CliSessionApprovalRow {
  return {
    id: "approval-12345678",
    cli_session_id: "session-12345678",
    provider: "claude",
    provider_session_id: "provider-session-1",
    tool_name: "Bash",
    tool_use_id: "toolu-1",
    request_json: "{}",
    status: "pending",
    decision_json: null,
    actor_id: null,
    requested_at: "2026-05-25T00:00:00.000Z",
    resolved_at: null,
    expires_at: "2026-05-25T00:10:00.000Z",
    ...overrides,
  };
}

describe("CLI session dashboard", () => {
  it("builds Discord-native dashboard components for idle continuation", () => {
    const message = buildCliSessionDashboardMessage({
      sessions: [session({})],
      now: new Date("2026-05-25T00:01:00.000Z"),
    });

    expect(message.embeds).toHaveLength(1);
    expect(message.components.length).toBeGreaterThanOrEqual(2);
    expect(message.components.some((row) =>
      row.components.some((component) => {
        const data = component.data as { custom_id?: string };
        return data.custom_id?.includes(":continue:");
      })
    )).toBe(true);
  });

  it("adds approve and deny buttons for pending approval sessions", () => {
    const message = buildCliSessionDashboardMessage({
      sessions: [session({
        phase: "waiting_for_approval",
        attention_kind: "approval",
      })],
      pendingApprovals: {
        "session-12345678": approval(),
      },
      now: new Date("2026-05-25T00:01:00.000Z"),
    });

    const customIds = message.components.flatMap((row) =>
      row.components.map((component) => (component.data as { custom_id?: string }).custom_id)
    );
    expect(customIds).toEqual(expect.arrayContaining([
      "miniclaw:cli-session:approve:approval-12345678",
      "miniclaw:cli-session:deny:approval-12345678",
    ]));
  });

  it("orders active sessions before newer idle sessions and hides closed or hidden sessions by default", () => {
    const message = buildCliSessionDashboardMessage({
      sessions: [
        session({
          id: "idle-new-session",
          phase: "waiting_for_input",
          last_activity_at: "2026-05-25T00:10:00.000Z",
        }),
        session({
          id: "active-old-session",
          phase: "processing",
          last_activity_at: "2026-05-25T00:00:00.000Z",
        }),
        session({
          id: "ended-session",
          phase: "ended",
          ended_at: "2026-05-25T00:09:00.000Z",
        }),
        session({
          id: "hidden-session",
          hidden_at: "2026-05-25T00:09:00.000Z",
        }),
      ],
      now: new Date("2026-05-25T00:11:00.000Z"),
      staleActiveMs: 30 * 60 * 1000,
    });

    const fields = message.embeds[0]?.data.fields ?? [];
    expect(fields.map((field) => field.name)).toEqual(["Active (1)", "Idle (1)"]);
    expect(fields[0]?.value).toContain("active-");
    expect(fields[1]?.value).toContain("idle-new");
    expect(JSON.stringify(fields)).not.toContain("ended-session");
    expect(JSON.stringify(fields)).not.toContain("hidden-session");
  });

  it("parses button and modal custom ids", () => {
    expect(parseCliSessionCustomId(buildCliSessionCustomId("continue", "session-1"))).toEqual({
      action: "continue",
      sessionId: "session-1",
    });
    expect(parseCliSessionContinueModalId(buildCliSessionContinueModalId("session-1"))).toEqual({
      sessionId: "session-1",
    });
    expect(parseCliSessionCustomId("miniclaw:cli-session:approve:approval-1")).toEqual({
      action: "approve",
      approvalId: "approval-1",
    });
  });
});

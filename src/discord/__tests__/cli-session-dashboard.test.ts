import { describe, expect, it } from "vitest";
import {
  buildCliSessionContinueModalId,
  buildCliSessionCustomId,
  buildCliSessionDashboardMessage,
  parseCliSessionContinueModalId,
  parseCliSessionCustomId,
} from "../cli-session-dashboard.js";
import type { CliSessionRow } from "../../hookd/types.js";

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

  it("parses button and modal custom ids", () => {
    expect(parseCliSessionCustomId(buildCliSessionCustomId("continue", "session-1"))).toEqual({
      action: "continue",
      sessionId: "session-1",
    });
    expect(parseCliSessionContinueModalId(buildCliSessionContinueModalId("session-1"))).toEqual({
      sessionId: "session-1",
    });
  });
});

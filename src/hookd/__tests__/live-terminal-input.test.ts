import { describe, expect, it, vi } from "vitest";
import type { CliSessionRow } from "../types.js";
import {
  extractItermSessionGuid,
  getCliSessionLiveTerminalEligibility,
  normalizeTty,
  parseItermSessionList,
  resolveItermTarget,
  sendCliSessionLiveTerminalInput,
} from "../live-terminal-input.js";

function session(overrides: Partial<CliSessionRow> = {}): CliSessionRow {
  return {
    id: "session-12345678",
    provider: "codex",
    provider_session_id: "provider-session-1",
    cwd: "/repo",
    pid: 123,
    tty: "ttys001",
    terminal_app: "iTerm.app",
    terminal_surface_json: JSON.stringify({
      iterm_session_id: "w0t0p0:B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA",
      term_program: "iTerm.app",
    }),
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

describe("live terminal input", () => {
  it("extracts iTerm2 session ids and normalizes tty values", () => {
    expect(extractItermSessionGuid(JSON.stringify({
      iterm_session_id: "w0t1p0:7C2F65E2-6510-4341-8577-2003BD0102F3",
    }))).toBe("7C2F65E2-6510-4341-8577-2003BD0102F3");
    expect(normalizeTty("ttys001")).toBe("/dev/ttys001");
    expect(normalizeTty("/dev/ttys001")).toBe("/dev/ttys001");
    expect(normalizeTty("??")).toBeUndefined();
  });

  it("parses iTerm2 AppleScript session lists", () => {
    expect(parseItermSessionList("ABC|/dev/ttys001, DEF|ttys002")).toEqual([
      { id: "ABC", tty: "/dev/ttys001" },
      { id: "DEF", tty: "/dev/ttys002" },
    ]);
  });

  it("resolves by recorded iTerm2 session id", async () => {
    const result = await resolveItermTarget(session(), {
      listItermSessions: async () => [
        { id: "B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA", tty: "/dev/ttys001" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      target: { id: "B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA", tty: "/dev/ttys001" },
    });
  });

  it("resolves by unique tty when no iTerm2 session id was recorded", async () => {
    const result = await resolveItermTarget(session({ terminal_surface_json: null }), {
      listItermSessions: async () => [
        { id: "SESSION-1", tty: "/dev/ttys001" },
        { id: "SESSION-2", tty: "/dev/ttys002" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      target: { id: "SESSION-1", tty: "/dev/ttys001" },
    });
  });

  it("fails when tty lookup is ambiguous or mismatched", async () => {
    await expect(resolveItermTarget(session({ terminal_surface_json: null }), {
      listItermSessions: async () => [
        { id: "SESSION-1", tty: "/dev/ttys001" },
        { id: "SESSION-2", tty: "/dev/ttys001" },
      ],
    })).resolves.toMatchObject({ ok: false, code: "target_ambiguous" });

    await expect(resolveItermTarget(session(), {
      listItermSessions: async () => [
        { id: "B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA", tty: "/dev/ttys009" },
      ],
    })).resolves.toMatchObject({ ok: false, code: "target_mismatch" });
  });

  it("reports dashboard eligibility only for idle iTerm2-backed live sessions", () => {
    expect(getCliSessionLiveTerminalEligibility(session()).ok).toBe(true);
    expect(getCliSessionLiveTerminalEligibility(session({
      provider: "claude",
      provider_session_id: "claude-session-1",
      latest_prompt: "claude follow-up",
    })).ok).toBe(true);
    expect(getCliSessionLiveTerminalEligibility(session({ phase: "processing" }))).toMatchObject({
      ok: false,
      code: "not_idle",
    });
    expect(getCliSessionLiveTerminalEligibility(session({
      terminal_app: "Apple_Terminal",
      terminal_surface_json: null,
    }))).toMatchObject({
      ok: false,
      code: "unsupported_terminal",
    });
  });

  it("sends text only when the process and iTerm2 target are still alive", async () => {
    const sendTextToItermSession = vi.fn(async () => undefined);
    const result = await sendCliSessionLiveTerminalInput(session(), "test followup", {
      isPidAlive: () => true,
      listItermSessions: async () => [
        { id: "B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA", tty: "/dev/ttys001" },
      ],
      sendTextToItermSession,
    });

    expect(result.ok).toBe(true);
    expect(sendTextToItermSession).toHaveBeenCalledWith(
      "B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA",
      "test followup",
    );

    await expect(sendCliSessionLiveTerminalInput(session(), "test followup", {
      isPidAlive: () => false,
      listItermSessions: async () => [
        { id: "B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA", tty: "/dev/ttys001" },
      ],
      sendTextToItermSession,
    })).resolves.toMatchObject({ ok: false, code: "pid_dead" });
  });
});

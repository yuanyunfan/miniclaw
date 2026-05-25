import { describe, expect, it } from "vitest";
import {
  claudePermissionResponse,
  normalizeProviderHookPayload,
} from "../hook-client.js";

describe("hook-client normalization", () => {
  it("normalizes provider payloads with event and tool metadata", () => {
    const normalized = normalizeProviderHookPayload({
      provider: "Claude",
      parentPid: 123,
      cwd: "/repo",
      env: {
        TERM_PROGRAM: "iTerm.app",
        ITERM_SESSION_ID: "iterm-session",
      },
      raw: {
        session_id: "session-1",
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "git status" },
        tool_use_id: "toolu-1",
      },
    });

    expect(normalized).toMatchObject({
      provider: "claude",
      providerSessionId: "session-1",
      eventName: "PermissionRequest",
      cwd: "/repo",
      pid: 123,
      terminalApp: "iTerm.app",
      toolName: "Bash",
      toolInput: { command: "git status" },
      toolUseId: "toolu-1",
    });
  });

  it("formats Claude PermissionRequest allow and deny responses", () => {
    expect(claudePermissionResponse({ decision: "allow" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
    expect(claudePermissionResponse({ decision: "deny", reason: "no" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: "no",
        },
      },
    });
    expect(claudePermissionResponse({ decision: "ask" })).toBeNull();
  });
});

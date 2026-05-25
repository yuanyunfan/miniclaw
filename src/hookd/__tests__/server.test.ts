import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __testables,
  startHookdSocketServer,
  type HookdSocketServerHandle,
} from "../server.js";
import { sendHookdEvent } from "../transport.js";
import type { CliSessionHookEvent } from "../types.js";

let tmp: string;
let handle: HookdSocketServerHandle | null = null;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-hookd-server-"));
});

afterEach(async () => {
  await handle?.stop();
  handle = null;
});

function waitForListening(server: HookdSocketServerHandle): Promise<void> {
  if (server.server.listening) return Promise.resolve();
  return new Promise((resolve) => server.server.once("listening", resolve));
}

describe("hookd socket server", () => {
  it("accepts newline-delimited hook events over a Unix socket", async () => {
    const events: CliSessionHookEvent[] = [];
    handle = startHookdSocketServer({
      socketPath: join(tmp, "hookd.sock"),
      onEvent: (event) => {
        events.push(event);
        return { session: event.providerSessionId };
      },
    });
    await waitForListening(handle);

    const result = await sendHookdEvent(handle.socketPath, {
      provider: "claude",
      session_id: "session-1",
      hook_event_name: "UserPromptSubmit",
      cwd: "/repo",
      parent_pid: 123,
    });

    expect(result).toEqual({ session: "session-1" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "claude",
      providerSessionId: "session-1",
      eventName: "UserPromptSubmit",
      phase: "processing",
      pid: 123,
    });
  });

  it("rejects unsupported provider payloads", () => {
    expect(() => __testables.parseHookEvent({
      provider: "unknown",
      session_id: "session-1",
      hook_event_name: "Stop",
      cwd: "/repo",
    })).toThrow("unsupported hook event provider");
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginActiveChat,
  getActiveChatCount,
  interruptActiveChats,
  listActiveChatsFromState,
  resetActiveChatRuntimeForTest,
  waitForActiveChatsToDrain,
} from "../chat-runtime.js";

let tmp: string;
let previousStatePath: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-active-chat-"));
  previousStatePath = process.env.MINICLAW_ACTIVE_CHAT_STATE_PATH;
  process.env.MINICLAW_ACTIVE_CHAT_STATE_PATH = join(tmp, "active-chats.json");
  resetActiveChatRuntimeForTest();
});

afterEach(() => {
  resetActiveChatRuntimeForTest();
  if (previousStatePath === undefined) delete process.env.MINICLAW_ACTIVE_CHAT_STATE_PATH;
  else process.env.MINICLAW_ACTIVE_CHAT_STATE_PATH = previousStatePath;
  rmSync(tmp, { recursive: true, force: true });
});

describe("active chat runtime", () => {
  it("persists active chats and clears them when finished", () => {
    const handle = beginActiveChat({
      channelId: "channel-1",
      userId: "user-1",
      prompt: "hello from chat",
    });

    expect(getActiveChatCount()).toBe(1);
    expect(listActiveChatsFromState()).toEqual([
      expect.objectContaining({
        id: handle.id,
        channel_id: "channel-1",
        user_id: "user-1",
        prompt: "hello from chat",
        pid: process.pid,
      }),
    ]);

    handle.finish();

    expect(getActiveChatCount()).toBe(0);
    expect(listActiveChatsFromState()).toEqual([]);
  });

  it("waits for active chats to drain", async () => {
    const handle = beginActiveChat({
      channelId: "channel-1",
      userId: "user-1",
      prompt: "long chat",
    });

    const drained = waitForActiveChatsToDrain(1000);
    setTimeout(() => handle.finish(), 5);

    await expect(drained).resolves.toBe(true);
  });

  it("interrupts active chats and aborts their signals", () => {
    const handle = beginActiveChat({
      channelId: "channel-1",
      userId: "user-1",
      prompt: "long chat",
    });

    expect(interruptActiveChats("shutdown")).toEqual([handle.id]);

    expect(handle.signal.aborted).toBe(true);
    expect(getActiveChatCount()).toBe(0);
    expect(listActiveChatsFromState()).toEqual([]);
  });
});

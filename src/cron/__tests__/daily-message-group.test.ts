import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendableChannels } from "discord.js";
import { setDb } from "../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";
import { createTask } from "../../store/db.js";
import { getCronDeliveryMessageGroup } from "../../store/cron-delivery-messages.js";
import { __testables, deliverDailyMessageGroup } from "../daily-message-group.js";

let db: Database.Database;

interface FakeMessage {
  id: string;
  content: string;
  deleted: boolean;
  edit: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function fakeChannel(): {
  channel: SendableChannels;
  sent: FakeMessage[];
  messages: Map<string, FakeMessage>;
} {
  const sent: FakeMessage[] = [];
  const messages = new Map<string, FakeMessage>();
  let next = 1;
  const channel = {
    send: vi.fn(async (payload: { content?: string }) => {
      const message: FakeMessage = {
        id: `message-${next++}`,
        content: payload.content ?? "",
        deleted: false,
        edit: vi.fn(async (nextPayload: { content?: string }) => {
          message.content = nextPayload.content ?? "";
          return message;
        }),
        delete: vi.fn(async () => {
          message.deleted = true;
          return message;
        }),
      };
      sent.push(message);
      messages.set(message.id, message);
      return message;
    }),
    messages: {
      fetch: vi.fn(async (id: string) => {
        const message = messages.get(id);
        if (!message || message.deleted) throw new Error(`missing message ${id}`);
        return message;
      }),
    },
  } as unknown as SendableChannels;
  return { channel, sent, messages };
}

beforeEach(() => {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("daily message group cron delivery", () => {
  it("formats the delivery key using the configured timezone", () => {
    expect(__testables.localDateKey(new Date("2026-05-19T16:30:00.000Z"), "Asia/Shanghai"))
      .toBe("2026-05-20");
  });

  it("edits the same day's message group and deletes extra old chunks", async () => {
    const { channel, sent } = fakeChannel();
    createTask({
      id: "task-1",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "browser tabs",
      cwd: "/tmp",
    });
    createTask({
      id: "task-2",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "browser tabs",
      cwd: "/tmp",
    });
    const base = {
      channel,
      jobName: "browser-tabs-hourly",
      channelId: "1000000000000000000",
      taskId: "task-1",
      runAt: new Date("2026-05-19T03:00:00.000Z"),
      timezone: "Asia/Shanghai",
    };

    await deliverDailyMessageGroup({
      ...base,
      text: "## Browser Tabs Sync\n" + "- first chunk line\n".repeat(180),
    });
    const firstIds = sent.map((message) => message.id);
    expect(firstIds.length).toBeGreaterThan(1);

    await deliverDailyMessageGroup({
      ...base,
      taskId: "task-2",
      text: "## Browser Tabs Sync\n- shorter update\n",
    });

    expect(sent.map((message) => message.id)).toEqual(firstIds);
    expect(sent[0]?.edit).toHaveBeenCalled();
    expect(sent.slice(1).every((message) => message.deleted)).toBe(true);
    const group = getCronDeliveryMessageGroup({
      jobName: "browser-tabs-hourly",
      channelId: "1000000000000000000",
      deliveryKey: "2026-05-19",
      deliveryMode: "daily_message_group",
    });
    expect(group?.taskId).toBe("task-2");
    expect(group?.messageIds).toEqual([firstIds[0]]);
  });

  it("starts a new message group on the next local day", async () => {
    const { channel, sent } = fakeChannel();
    createTask({
      id: "task-1",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "browser tabs",
      cwd: "/tmp",
    });
    createTask({
      id: "task-2",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "browser tabs",
      cwd: "/tmp",
    });
    const common = {
      channel,
      jobName: "browser-tabs-hourly",
      channelId: "1000000000000000000",
      timezone: "Asia/Shanghai",
    };

    await deliverDailyMessageGroup({
      ...common,
      taskId: "task-1",
      runAt: new Date("2026-05-19T03:00:00.000Z"),
      text: "day one",
    });
    await deliverDailyMessageGroup({
      ...common,
      taskId: "task-2",
      runAt: new Date("2026-05-20T03:00:00.000Z"),
      text: "day two",
    });

    expect(sent.map((message) => message.id)).toEqual(["message-1", "message-2"]);
    expect(getCronDeliveryMessageGroup({
      jobName: "browser-tabs-hourly",
      channelId: "1000000000000000000",
      deliveryKey: "2026-05-19",
      deliveryMode: "daily_message_group",
    })?.messageIds).toEqual(["message-1"]);
    expect(getCronDeliveryMessageGroup({
      jobName: "browser-tabs-hourly",
      channelId: "1000000000000000000",
      deliveryKey: "2026-05-20",
      deliveryMode: "daily_message_group",
    })?.messageIds).toEqual(["message-2"]);
  });
});

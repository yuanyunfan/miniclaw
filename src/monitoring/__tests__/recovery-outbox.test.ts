import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageFlags, type Client } from "discord.js";
import { setDb } from "../../store/connection.js";
import { ensureBaseSchema, runMigrations } from "../../store/schema.js";
import {
  createCronRun,
  getCronRun,
  markCronRunFailed,
} from "../../store/cron-runs.js";
import {
  enqueuePreProviderAttachmentDelivery,
  enqueueTaskResultDelivery,
  flushTaskResultDeliveriesForTarget,
  flushRecoveryOutbox,
} from "../recovery-outbox.js";
import { listRecoveryOutbox } from "../../store/recovery-outbox.js";
import { createTask } from "../../store/repositories/tasks.js";
import type { ConnectivitySnapshot } from "../connectivity-core.js";
import type { IMTransport } from "../../im/contracts.js";
import type { IMTransportRegistry } from "../../im/registry.js";

let db: Database.Database;
let previousCronDir: string | undefined;

function clientRecordingSends(sent: unknown[]): Client {
  let nextId = 1;
  return {
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async (payload: unknown) => {
          sent.push(payload);
          return { id: `msg-${nextId++}` };
        },
      }),
    },
  } as unknown as Client;
}

beforeEach(() => {
  db = new Database(":memory:");
  setDb(db);
  ensureBaseSchema(db);
  runMigrations(db);
  previousCronDir = process.env.MINICLAW_CRON_DIR;
  const cronDir = mkdtempSync(join(tmpdir(), "miniclaw-recovery-cron-"));
  process.env.MINICLAW_CRON_DIR = cronDir;
  writeFileSync(join(cronDir, "daily-job.yaml"), `
name: daily-job
schedule: "* * * * *"
enabled: true
type: message
channel: "123456789012345678"
content: "hello"
`);
});

afterEach(() => {
  if (previousCronDir === undefined) delete process.env.MINICLAW_CRON_DIR;
  else process.env.MINICLAW_CRON_DIR = previousCronDir;
  db.close();
});

describe("recovery outbox flush", () => {
  it("backfills failed cron runs from an outage window and sends one recovery summary", async () => {
    createCronRun({
      id: "cron-run-1",
      jobName: "daily-job",
      jobType: "message",
      startedAt: "2026-05-13T10:00:00.000Z",
      metadata: { failure_run_id: "retry-chain-1" },
    });
    markCronRunFailed("cron-run-1", {
      completedAt: "2026-05-13T10:01:00.000Z",
      errorCategory: "Error",
      errorMessage: "getaddrinfo ENOTFOUND discord.com (attempt 5/5; retries exhausted)",
    });
    const snapshot: ConnectivitySnapshot = {
      updated_at: "2026-05-13T10:10:00.000Z",
      status: "recovered",
      consecutive_failures: 0,
      last_outage_started_at: "2026-05-13T09:59:00.000Z",
      checks: {
        discord_gateway: { ok: true },
        discord_rest: { ok: true },
        general_network: { ok: true },
        smtp: { ok: true },
      },
    };
    const sent: unknown[] = [];

    const result = await flushRecoveryOutbox(clientRecordingSends(sent), { snapshot });

    expect(result).toMatchObject({ backfilledCronAlerts: 1, cronAlertsDelivered: 1, failedAttempts: 0 });
    expect(JSON.stringify(sent[0])).toContain("网络中断期间错过的定时任务失败通知");
    expect(JSON.stringify(sent[0])).toContain("daily-job");
    expect(JSON.stringify(sent[0])).toContain("miniclaw:cron:retry:retry-chain-1");
    expect(getCronRun("cron-run-1")?.alert_message_id).toBe("msg-1");
    expect(listRecoveryOutbox({ kind: "cron_failure_alert" })[0]?.status).toBe("delivered");
  });

  it("delivers pending task results after Discord becomes reachable", async () => {
    createTask({
      id: "task-1",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "hello",
      cwd: "/tmp",
    });
    enqueueTaskResultDelivery({
      channelId: "channel-1",
      taskId: "task-1",
      jobName: "daily-job",
      route: "cron_task",
      success: true,
      durationMs: 1234,
      messages: ["final result"],
      deliveryError: "discord down",
    });
    const sent: unknown[] = [];

    const result = await flushRecoveryOutbox(clientRecordingSends(sent));

    expect(result).toMatchObject({ taskDeliveriesDelivered: 1, failedAttempts: 0 });
    expect((sent[0] as { content: string }).content).toContain("补发任务结果");
    expect((sent[1] as { content: string }).content).toBe("final result");
    expect(listRecoveryOutbox({ kind: "task_result_delivery" })[0]?.status).toBe("delivered");
  });

  it("delivers pending pre_provider attachments after Discord becomes reachable", async () => {
    createTask({
      id: "task-attachment-1",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "hello",
      cwd: "/tmp",
    });
    const tmp = mkdtempSync(join(tmpdir(), "miniclaw-recovery-attachment-"));
    const chartPath = join(tmp, "asset-pie.png");
    writeFileSync(chartPath, "png");
    enqueuePreProviderAttachmentDelivery({
      channelId: "channel-1",
      taskId: "task-attachment-1",
      jobName: "daily-job",
      attachments: [{
        path: chartPath,
        name: "asset-pie.png",
        description: "asset pie",
      }],
      deliveryError: new DOMException("This operation was aborted", "AbortError"),
    });
    const sent: unknown[] = [];

    try {
      const result = await flushRecoveryOutbox(clientRecordingSends(sent));

      expect(result).toMatchObject({ attachmentDeliveriesDelivered: 1, failedAttempts: 0 });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        content: expect.stringContaining("补发 cron `daily-job` 附图"),
        files: expect.arrayContaining([expect.anything()]),
      });
      const row = listRecoveryOutbox({ kind: "pre_provider_attachment_delivery" })[0];
      expect(row).toMatchObject({ status: "delivered", message_id: "msg-1" });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("defers link previews when replaying pending task results", async () => {
    createTask({
      id: "task-1",
      discord_thread_id: "",
      discord_user_id: "cron",
      prompt: "hello",
      cwd: "/tmp",
    });
    enqueueTaskResultDelivery({
      channelId: "channel-1",
      taskId: "task-1",
      jobName: "daily-job",
      route: "cron_task",
      success: true,
      messages: ["正文 https://example.com/a"],
      deliveryError: "discord down",
    });
    const sent: unknown[] = [];

    await flushRecoveryOutbox(clientRecordingSends(sent));

    expect(sent).toHaveLength(3);
    expect(sent[1]).toMatchObject({
      content: "正文 https://example.com/a",
      flags: MessageFlags.SuppressEmbeds,
    });
    expect((sent[2] as { content: string; flags?: unknown }).content).toContain("链接预览集中区");
    expect((sent[2] as { content: string; flags?: unknown }).content).toContain("https://example.com/a");
    expect((sent[2] as { flags?: unknown }).flags).toBeUndefined();
  });

  it("leaves pending Weixin task results for fresh inbound target flush", async () => {
    createTask({
      id: "task-weixin-1",
      discord_thread_id: "",
      discord_user_id: "weixin:user@im.wechat",
      prompt: "hello",
      cwd: "/tmp",
    });
    enqueueTaskResultDelivery({
      channelId: "weixin:acct:user@im.wechat",
      taskId: "task-weixin-1",
      route: "weixin_smart_task",
      success: true,
      messages: ["final result"],
      deliveryError: "weixin send failed",
      target: { transport: "weixin", target: "user@im.wechat", accountId: "acct" },
    });
    const sent: unknown[] = [];
    const weixinTransport: IMTransport = {
      id: "weixin",
      kind: "im_transport",
      capabilities: {
        richEmbeds: false,
        markdown: "plain",
        editMessage: false,
        threads: false,
        files: true,
        buttons: false,
        slashCommands: false,
        mentions: false,
      },
      send: async (input) => {
        sent.push(input);
        return {
          transport: "weixin",
          target: input.target.target,
          accountId: input.target.accountId,
          messageId: `wx-${sent.length}`,
        };
      },
    };
    const registry: IMTransportRegistry = new Map([["weixin", weixinTransport]]);

    const result = await flushRecoveryOutbox(clientRecordingSends([]), { registry });

    expect(result).toMatchObject({ taskDeliveriesDelivered: 0, failedAttempts: 0 });
    expect(sent).toHaveLength(0);
    expect(listRecoveryOutbox({ kind: "task_result_delivery" })[0]?.status).toBe("pending");
  });

  it("flushes only matching pending Weixin task results for a fresh inbound target", async () => {
    createTask({
      id: "task-weixin-1",
      discord_thread_id: "",
      discord_user_id: "weixin:user@im.wechat",
      prompt: "hello",
      cwd: "/tmp",
    });
    createTask({
      id: "task-weixin-2",
      discord_thread_id: "",
      discord_user_id: "weixin:other@im.wechat",
      prompt: "hello",
      cwd: "/tmp",
    });
    enqueueTaskResultDelivery({
      channelId: "weixin:acct:user@im.wechat",
      taskId: "task-weixin-1",
      success: true,
      messages: ["target result"],
      target: { transport: "weixin", target: "user@im.wechat", accountId: "acct" },
    });
    enqueueTaskResultDelivery({
      channelId: "weixin:acct:other@im.wechat",
      taskId: "task-weixin-2",
      success: true,
      messages: ["other result"],
      target: { transport: "weixin", target: "other@im.wechat", accountId: "acct" },
    });
    const sent: unknown[] = [];
    const weixinTransport: IMTransport = {
      id: "weixin",
      kind: "im_transport",
      capabilities: {
        richEmbeds: false,
        markdown: "plain",
        editMessage: false,
        threads: false,
        files: true,
        buttons: false,
        slashCommands: false,
        mentions: false,
      },
      send: async (input) => {
        sent.push(input);
        return {
          transport: "weixin",
          target: input.target.target,
          messageId: `wx-${sent.length}`,
        };
      },
    };
    const registry: IMTransportRegistry = new Map([["weixin", weixinTransport]]);

    const result = await flushTaskResultDeliveriesForTarget({
      target: { transport: "weixin", target: "user@im.wechat", accountId: "acct" },
      registry,
    });

    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent)).toContain("target result");
    expect(JSON.stringify(sent)).not.toContain("other result");
    const rows = listRecoveryOutbox({ kind: "task_result_delivery" });
    expect(rows.find((row) => row.task_id === "task-weixin-1")?.status).toBe("delivered");
    expect(rows.find((row) => row.task_id === "task-weixin-2")?.status).toBe("pending");
  });
});

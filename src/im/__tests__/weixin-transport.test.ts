import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWeixinTextMessage, extractWeixinText, getWeixinUpdates, sendWeixinText, __testables } from "../adapters/weixin/api.js";
import { parseWeixinTaskCommand, __testables as gatewayTestables } from "../adapters/weixin/gateway.js";
import { saveWeixinAccount, saveWeixinContextToken } from "../adapters/weixin/store.js";
import { createWeixinTransport } from "../adapters/weixin/transport.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-weixin-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Weixin API helpers", () => {
  it("builds iLink client version and text send payloads", () => {
    expect(__testables.clientVersion("2.4.3")).toBe(132099);
    expect(buildWeixinTextMessage({
      to: "user@im.wechat",
      text: "hello",
      contextToken: "ctx",
      clientId: "client-1",
    })).toMatchObject({
      msg: {
        to_user_id: "user@im.wechat",
        client_id: "client-1",
        context_token: "ctx",
        item_list: [{ type: 1, text_item: { text: "hello" } }],
      },
    });
  });

  it("sends text through the Weixin HTTP JSON API", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ ret: 0 });
    }) as typeof fetch;

    await sendWeixinText({
      to: "user@im.wechat",
      text: "hello",
      contextToken: "ctx",
      options: {
        baseUrl: "https://weixin.test/",
        token: "token",
        fetchFn,
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://weixin.test/ilink/bot/sendmessage");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({
      AuthorizationType: "ilink_bot_token",
      Authorization: "Bearer token",
      "iLink-App-Id": "bot",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      msg: {
        to_user_id: "user@im.wechat",
        context_token: "ctx",
      },
      base_info: {
        channel_version: "2.4.3",
        bot_agent: "MiniClaw",
      },
    });
  });

  it("long-polls getupdates with the persisted buffer and base_info", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ ret: 0, msgs: [], get_updates_buf: "next" });
    }) as typeof fetch;

    const resp = await getWeixinUpdates({
      getUpdatesBuf: "prev",
      options: {
        baseUrl: "https://weixin.test/",
        token: "token",
        fetchFn,
      },
    });

    expect(resp.get_updates_buf).toBe("next");
    expect(calls[0]?.url).toBe("https://weixin.test/ilink/bot/getupdates");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      get_updates_buf: "prev",
      base_info: {
        channel_version: "2.4.3",
        bot_agent: "MiniClaw",
      },
    });
  });

  it("extracts text and voice transcription bodies", () => {
    expect(extractWeixinText({ item_list: [{ type: 1, text_item: { text: "typed" } }] })).toBe("typed");
    expect(extractWeixinText({ item_list: [{ type: 3, voice_item: { text: "spoken" } }] })).toBe("spoken");
  });
});

describe("Weixin transport", () => {
  it("loads local account state and reuses stored context tokens", async () => {
    saveWeixinAccount("acct", {
      token: "token",
      baseUrl: "https://weixin.test/",
      userId: "owner@im.wechat",
    }, tmpDir);
    saveWeixinContextToken("acct", "user@im.wechat", "ctx", tmpDir);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ ret: 0 });
    }) as typeof fetch;

    const transport = createWeixinTransport({ stateDir: tmpDir, fetchFn });
    const sent = await transport.send({
      target: { transport: "weixin", target: "user@im.wechat", accountId: "acct" },
      content: "hello",
    });

    expect(sent).toMatchObject({ transport: "weixin", target: "user@im.wechat", accountId: "acct" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      msg: { context_token: "ctx" },
    });
  });
});

describe("Weixin gateway helpers", () => {
  it("detects textual task commands without treating normal chat as task", () => {
    expect(parseWeixinTaskCommand("/task 更新一下日报")).toBe("更新一下日报");
    expect(parseWeixinTaskCommand("任务：检查 cron 状态")).toBe("检查 cron 状态");
    expect(parseWeixinTaskCommand("聊一下今天安排")).toBeUndefined();
  });

  it("wraps task prompts with untrusted Weixin source metadata", () => {
    const prompt = gatewayTestables.buildTaskPrompt(
      { accountId: "acct", token: "token" },
      { from_user_id: "owner@im.wechat", message_id: 42, create_time_ms: 1779173523000 },
      "run diagnostics"
    );

    expect(prompt).toContain("<task_source_metadata trust=\"untrusted\">");
    expect(prompt).toContain("\"provider\": \"weixin\"");
    expect(prompt).toContain("<user_task priority=\"current\">\nrun diagnostics\n</user_task>");
  });

  it("uses y/n as task/chat confirmation and keeps cancel separate", () => {
    expect(gatewayTestables.isConfirm("y")).toBe(true);
    expect(gatewayTestables.isConfirm("确认")).toBe(true);
    expect(gatewayTestables.isContinueChat("n")).toBe(true);
    expect(gatewayTestables.isContinueChat("继续")).toBe(true);
    expect(gatewayTestables.isCancel("取消")).toBe(true);
    expect(gatewayTestables.isCancel("n")).toBe(false);
  });

  it("extracts Weixin text, voice transcript, and image attachments for model input", () => {
    const content = gatewayTestables.extractInboundContent({
      message_id: 7,
      item_list: [
        { type: 1, text_item: { text: "看一下这张图" } },
        { type: 3, voice_item: { text: "顺便总结一下" } },
        {
          type: 2,
          image_item: {
            image_url: "https://cdn.test/pic.jpg",
            file_name: "pic.jpg",
            file_size: "1234",
            mime_type: "image/jpeg",
          },
        },
      ],
    });

    expect(content.prompt).toContain("看一下这张图");
    expect(content.prompt).toContain("[语音转写]");
    expect(content.prompt).toContain("顺便总结一下");
    expect(content.attachments).toEqual([
      {
        url: "https://cdn.test/pic.jpg",
        name: "pic.jpg",
        contentType: "image/jpeg",
        size: 1234,
      },
    ]);
  });
});

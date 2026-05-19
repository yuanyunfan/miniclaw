import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWeixinTextMessage,
  extractWeixinText,
  getWeixinConfig,
  getWeixinUpdates,
  pollWeixinQrLogin,
  sendWeixinText,
  sendWeixinTyping,
  startWeixinQrLogin,
  type WeixinMessage,
  WeixinTypingStatus,
  __testables,
} from "../adapters/weixin/api.js";
import { parseWeixinTaskCommand, __testables as gatewayTestables } from "../adapters/weixin/gateway.js";
import { materializeWeixinAttachments, __testables as mediaTestables, type WeixinProcessableAttachment } from "../adapters/weixin/media.js";
import { __resetWeixinSessionPauseForTests, getWeixinSessionPauseRemainingMs, pauseWeixinSession } from "../adapters/weixin/session.js";
import { saveWeixinAccount, saveWeixinContextToken } from "../adapters/weixin/store.js";
import { createWeixinTransport } from "../adapters/weixin/transport.js";

let tmpDir: string;

interface WeixinOfficialFixtures {
  source: {
    package_name: string;
    package_version: string;
  };
  inboundImage: WeixinMessage;
  inboundVoice: WeixinMessage;
  outboundImageUpload: {
    getUploadUrlResp: {
      ret: number;
      upload_param: string;
      upload_full_url: string;
    };
    cdnUploadRespHeaders: Record<string, string>;
  };
  qr: {
    startResp: {
      qrcode: string;
      qrcode_img_content: string;
    };
    expiredStatusResp: {
      status: "expired";
    };
  };
  sessionExpired: {
    getUpdatesResp: {
      ret: number;
      errcode: number;
      errmsg: string;
    };
  };
  routing: {
    chatText: string;
    taskText: string;
    taskConfirm: string;
    taskDecline: string;
  };
}

const officialFixtures = JSON.parse(
  readFileSync(new URL("../__fixtures__/weixin-official-payloads.json", import.meta.url), "utf8"),
) as WeixinOfficialFixtures;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "miniclaw-weixin-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetWeixinSessionPauseForTests();
  gatewayTestables.resetTypingTicketCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Weixin API helpers", () => {
  it("records the official package protocol version used by the native adapter", () => {
    expect(officialFixtures.source).toMatchObject({
      package_name: "@tencent-weixin/openclaw-weixin",
      package_version: "2.4.3",
    });
  });

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

  it("passes recent local token list when starting QR login", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(officialFixtures.qr.startResp);
    }) as typeof fetch;

    await startWeixinQrLogin({ fetchFn, localTokenList: ["token-a", "token-b"] });

    expect(calls[0]?.url).toContain("/ilink/bot/get_bot_qrcode?bot_type=3");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      local_token_list: ["token-a", "token-b"],
    });
  });

  it("parses official QR expired status payloads so the login script can refresh", async () => {
    const fetchFn = (async () => jsonResponse(officialFixtures.qr.expiredStatusResp)) as typeof fetch;

    const resp = await pollWeixinQrLogin({
      qrcode: "fixture-qr-token",
      options: { baseUrl: "https://weixin.test/", fetchFn },
    });

    expect(resp.status).toBe("expired");
  });

  it("fetches typing config and sends typing status payloads", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(String(url).endsWith("/ilink/bot/getconfig")
        ? { ret: 0, typing_ticket: "ticket" }
        : { ret: 0 });
    }) as typeof fetch;

    const configResp = await getWeixinConfig({
      ilinkUserId: "user@im.wechat",
      contextToken: "ctx",
      options: { baseUrl: "https://weixin.test/", token: "token", fetchFn },
    });
    await sendWeixinTyping({
      to: "user@im.wechat",
      typingTicket: configResp.typing_ticket ?? "",
      status: WeixinTypingStatus.TYPING,
      options: { baseUrl: "https://weixin.test/", token: "token", fetchFn },
    });

    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      ilink_user_id: "user@im.wechat",
      context_token: "ctx",
    });
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      ilink_user_id: "user@im.wechat",
      typing_ticket: "ticket",
      status: 1,
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

  it("uploads and sends image files through the Weixin CDN media path", async () => {
    saveWeixinAccount("acct", {
      token: "token",
      baseUrl: "https://weixin.test/",
      userId: "owner@im.wechat",
    }, tmpDir);
    saveWeixinContextToken("acct", "user@im.wechat", "ctx", tmpDir);
    const filePath = join(tmpDir, "pic.jpg");
    writeFileSync(filePath, Buffer.from("fake image bytes"));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const href = String(url);
      if (href.endsWith("/ilink/bot/getuploadurl")) {
        return jsonResponse(officialFixtures.outboundImageUpload.getUploadUrlResp);
      }
      if (href === "https://cdn.test/fixture-upload") {
        return new Response("", {
          status: 200,
          headers: officialFixtures.outboundImageUpload.cdnUploadRespHeaders,
        });
      }
      if (href.endsWith("/ilink/bot/sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({ ret: 0 });
    });

    const transport = createWeixinTransport({ stateDir: tmpDir, fetchFn: fetchFn as unknown as typeof fetch });
    await transport.sendFile?.({
      target: { transport: "weixin", target: "user@im.wechat", accountId: "acct" },
      path: filePath,
      name: "pic.jpg",
      description: "caption",
    });

    const uploadReq = JSON.parse(String(calls.find((call) => call.url.endsWith("/getuploadurl"))?.init.body));
    expect(uploadReq).toMatchObject({
      media_type: 1,
      to_user_id: "user@im.wechat",
      rawsize: "fake image bytes".length,
    });
    const sendRequests = calls
      .filter((call) => call.url.endsWith("/sendmessage"))
      .map((call) => JSON.parse(String(call.init.body)));
    expect(sendRequests).toHaveLength(2);
    expect(sendRequests[0]?.msg).toMatchObject({
      to_user_id: "user@im.wechat",
      context_token: "ctx",
      item_list: [{ type: 1, text_item: { text: "caption" } }],
    });
    expect(sendRequests[1]?.msg).toMatchObject({
      to_user_id: "user@im.wechat",
      context_token: "ctx",
      item_list: [{ type: 2, image_item: { media: { encrypt_query_param: "fixture-download-param", encrypt_type: 1 } } }],
    });
  });

  it("blocks outbound sends while a Weixin account session is paused", async () => {
    saveWeixinAccount("acct", { token: "token", baseUrl: "https://weixin.test/" }, tmpDir);
    pauseWeixinSession("acct");
    const transport = createWeixinTransport({ stateDir: tmpDir });

    await expect(transport.send({
      target: { transport: "weixin", target: "user@im.wechat", accountId: "acct" },
      content: "hello",
    })).rejects.toThrow(/session paused/);
  });
});

describe("Weixin gateway helpers", () => {
  it("detects textual task commands without treating normal chat as task", () => {
    expect(parseWeixinTaskCommand("/task 更新一下日报")).toBe("更新一下日报");
    expect(parseWeixinTaskCommand(officialFixtures.routing.taskText)).toBe("check Weixin smoke state");
    expect(parseWeixinTaskCommand("任务：检查 cron 状态")).toBe("检查 cron 状态");
    expect(parseWeixinTaskCommand(officialFixtures.routing.chatText)).toBeUndefined();
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
    expect(gatewayTestables.isConfirm(officialFixtures.routing.taskConfirm)).toBe(true);
    expect(gatewayTestables.isConfirm("确认")).toBe(true);
    expect(gatewayTestables.isContinueChat(officialFixtures.routing.taskDecline)).toBe(true);
    expect(gatewayTestables.isContinueChat("继续")).toBe(true);
    expect(gatewayTestables.isCancel("取消")).toBe(true);
    expect(gatewayTestables.isCancel("n")).toBe(false);
  });

  it("pauses polling for session-expired getupdates responses instead of entering the retry loop", async () => {
    const controller = new AbortController();
    const getUpdates = vi.fn(async () => officialFixtures.sessionExpired.getUpdatesResp);
    const handleMessage = vi.fn();
    const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {
      controller.abort();
    });

    await gatewayTestables.pollAccount(
      { accountId: "acct", token: "token", baseUrl: "https://weixin.test/" },
      controller.signal,
      { getUpdates, handleMessage, sleep },
    );

    expect(getUpdates).toHaveBeenCalledTimes(1);
    expect(handleMessage).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThan(59 * 60 * 1000);
    expect(getWeixinSessionPauseRemainingMs("acct")).toBeGreaterThan(59 * 60 * 1000);
  });

  it("starts and cancels Weixin typing with the cached getconfig ticket", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(String(url).endsWith("/ilink/bot/getconfig")
        ? { ret: 0, typing_ticket: "ticket" }
        : { ret: 0 });
    }));

    const handle = await gatewayTestables.startWeixinTyping(
      { accountId: "acct", token: "token", baseUrl: "https://weixin.test/" },
      "user@im.wechat",
      "ctx",
    );
    await handle?.stop();

    const bodies = calls.map((call) => JSON.parse(String(call.init.body)));
    expect(calls.map((call) => call.url)).toEqual([
      "https://weixin.test/ilink/bot/getconfig",
      "https://weixin.test/ilink/bot/sendtyping",
      "https://weixin.test/ilink/bot/sendtyping",
    ]);
    expect(bodies[0]).toMatchObject({ ilink_user_id: "user@im.wechat", context_token: "ctx" });
    expect(bodies[1]).toMatchObject({ typing_ticket: "ticket", status: WeixinTypingStatus.TYPING });
    expect(bodies[2]).toMatchObject({ typing_ticket: "ticket", status: WeixinTypingStatus.CANCEL });
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

  it("materializes official encrypted CDN image payloads for model input", async () => {
    const plaintext = Buffer.from("image-bytes");
    const aeskey = Buffer.alloc(16);
    const encrypted = mediaTestables.encryptAesEcb(plaintext, aeskey);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(encrypted), { status: 200 })));

    const content = gatewayTestables.extractInboundContent(officialFixtures.inboundImage);

    expect(content.attachments[0]?.url).toContain("weixin-cdn://image/");
    const materialized = await materializeWeixinAttachments(
      content.attachments as WeixinProcessableAttachment[],
      { dir: join(tmpDir, "materialized") },
    );

    expect(materialized.notices).toEqual([]);
    expect(materialized.attachments[0]).toMatchObject({
      name: "weixin-image-2403001.jpg",
      contentType: "image/jpeg",
      size: plaintext.length,
    });
    expect(readFileSync(new URL(materialized.attachments[0]!.url))).toEqual(plaintext);
  });

  it("materializes official encrypted CDN voice payloads and keeps SILK when transcoding is unavailable", async () => {
    const plaintext = Buffer.from("not-a-real-silk-frame");
    const aeskey = Buffer.alloc(16);
    const encrypted = mediaTestables.encryptAesEcb(plaintext, aeskey);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(encrypted), { status: 200 })));

    const content = gatewayTestables.extractInboundContent(officialFixtures.inboundVoice);

    expect(content.attachments[0]?.url).toContain("weixin-cdn://voice/");
    const materialized = await materializeWeixinAttachments(
      content.attachments as WeixinProcessableAttachment[],
      { dir: join(tmpDir, "materialized-voice") },
    );

    expect(materialized.notices[0]).toContain("SILK");
    expect(materialized.attachments[0]).toMatchObject({
      name: "weixin-voice-2403002.silk",
      contentType: "audio/silk",
      size: plaintext.length,
    });
    expect(readFileSync(new URL(materialized.attachments[0]!.url))).toEqual(plaintext);
  });
});

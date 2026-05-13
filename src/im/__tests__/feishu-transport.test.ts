import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeishuWebhookTransport, __testables } from "../adapters/feishu/transport.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feishu webhook transport", () => {
  it("builds signed text payloads for custom bot webhooks", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const payload = __testables.feishuPayload("hello", "secret");

    expect(payload).toMatchObject({
      msg_type: "text",
      content: { text: "hello" },
      timestamp: "1700000000",
    });
    expect(payload.sign).toBe("fiWS2+gh28DOydAv7hzONH/mDn9+b1Y4Y5ivXWXy8vA=");
  });

  it("posts text messages to the configured webhook", async () => {
    const bodies: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 });
    }) as typeof fetch;
    const transport = createFeishuWebhookTransport({
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
      fetchFn,
    });

    const sent = await transport.send({
      target: { transport: "feishu", target: "default" },
      content: "飞书测试",
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(bodies[0]).toEqual({
      msg_type: "text",
      content: { text: "飞书测试" },
    });
    expect(sent.transport).toBe("feishu");
    expect(sent.target).toBe("default");
    expect(sent.messageId).toBeTruthy();
  });

  it("fails on non-zero Feishu response codes", async () => {
    const transport = createFeishuWebhookTransport({
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
      fetchFn: vi.fn(async () => new Response(JSON.stringify({ code: 19024, msg: "bad sign" }), { status: 200 })) as typeof fetch,
    });

    await expect(transport.send({
      target: { transport: "feishu", target: "default" },
      content: "hello",
    })).rejects.toThrow(/Feishu webhook error 19024/);
  });
});

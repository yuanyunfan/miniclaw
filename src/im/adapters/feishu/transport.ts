import { createHmac, randomUUID } from "node:crypto";
import type { IMTransport, SentMessage } from "../../contracts.js";

interface FeishuWebhookOptions {
  webhookUrl?: string;
  secret?: string;
  fetchFn?: typeof fetch;
}

interface FeishuWebhookResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
}

function signFeishuWebhook(timestamp: string, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

function assertConfigured(url?: string): string {
  if (!url) throw new Error("Feishu transport requires MINICLAW_FEISHU_WEBHOOK_URL or im.transports.feishu.webhook_url");
  return url;
}

function feishuPayload(content: string, secret?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    msg_type: "text",
    content: {
      text: content,
    },
  };
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    payload.timestamp = timestamp;
    payload.sign = signFeishuWebhook(timestamp, secret);
  }
  return payload;
}

function assertFeishuOk(status: number, text: string): void {
  if (status < 200 || status >= 300) {
    throw new Error(`Feishu webhook HTTP ${status}: ${text.slice(0, 500)}`);
  }
  let parsed: FeishuWebhookResponse | undefined;
  try {
    parsed = JSON.parse(text) as FeishuWebhookResponse;
  } catch {
    return;
  }
  const code = parsed.code ?? parsed.StatusCode ?? 0;
  if (code !== 0) {
    throw new Error(`Feishu webhook error ${code}: ${(parsed.msg ?? parsed.StatusMessage ?? text).slice(0, 500)}`);
  }
}

export function createFeishuWebhookTransport(options: FeishuWebhookOptions): IMTransport {
  return {
    id: "feishu",
    kind: "im_transport",
    capabilities: {
      richEmbeds: false,
      markdown: "feishu",
      editMessage: false,
      threads: false,
      files: false,
      buttons: false,
      slashCommands: false,
      mentions: false,
    },
    async send(input): Promise<SentMessage> {
      const webhookUrl = assertConfigured(options.webhookUrl);
      const response = await (options.fetchFn ?? fetch)(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feishuPayload(input.content.slice(0, 3900), options.secret)),
      });
      const text = await response.text();
      assertFeishuOk(response.status, text);
      return {
        transport: "feishu",
        target: input.target.target,
        threadId: input.target.threadId,
        messageId: randomUUID(),
      };
    },
  };
}

export const __testables = {
  feishuPayload,
  signFeishuWebhook,
  assertFeishuOk,
};

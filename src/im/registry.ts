import type { Client } from "discord.js";
import type { RuntimeConfig } from "../config.js";
import type { IMTransportId } from "../config/types.js";
import type { IMTransport } from "./contracts.js";
import { createDiscordTransport } from "./adapters/discord/transport.js";
import { createFeishuWebhookTransport } from "./adapters/feishu/transport.js";
import { createWeixinTransport } from "./adapters/weixin/transport.js";

export type IMTransportRegistry = ReadonlyMap<IMTransportId, IMTransport>;
type IMRuntimeConfig = RuntimeConfig["im"];

export function createIMTransportRegistry(client?: Client, imConfig?: IMRuntimeConfig): IMTransportRegistry {
  const transports = new Map<IMTransportId, IMTransport>();
  const discordEnabled = imConfig?.transports.discord.enabled ?? true;
  if (discordEnabled && client) {
    transports.set("discord", createDiscordTransport(client));
  }
  if (imConfig?.transports.feishu.enabled) {
    transports.set("feishu", createFeishuWebhookTransport({
      webhookUrl: imConfig.transports.feishu.webhookUrl,
      secret: imConfig.transports.feishu.secret,
    }));
  }
  if (imConfig?.transports.weixin.enabled) {
    transports.set("weixin", createWeixinTransport({
      stateDir: imConfig.transports.weixin.stateDir,
      defaultAccountId: imConfig.transports.weixin.defaultAccountId,
    }));
  }
  return transports;
}

export function requireIMTransport(registry: IMTransportRegistry, id: IMTransportId): IMTransport {
  const transport = registry.get(id);
  if (!transport) throw new Error(`IM transport '${id}' is not configured`);
  return transport;
}

import type { Client } from "discord.js";
import type { RuntimeConfig } from "../config.js";
import type { IMRouteConfig, IMTransportId } from "../config/types.js";
import { chunkMessageWithDeferredLinkPreviews } from "../discord/chunks.js";
import type { IMDeliveryTarget, SentMessage } from "./contracts.js";
import { createIMTransportRegistry, requireIMTransport, type IMTransportRegistry } from "./registry.js";

const FEISHU_CHUNK_SIZE = 3900;

export interface IMDeliveryResult {
  target: IMDeliveryTarget;
  message?: SentMessage;
  error?: Error;
}

export interface ResolveDeliveryTargetsOptions {
  route?: string;
  fallbackDiscordTarget?: string;
  includeFallback?: boolean;
  extraOnly?: boolean;
  routes?: Record<string, IMRouteConfig>;
}

type IMRuntimeConfig = RuntimeConfig["im"];

interface IMTextChunk {
  content: string;
  suppressEmbeds?: boolean;
}

function chunkText(text: string, size: number): IMTextChunk[] {
  const chunks: IMTextChunk[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push({ content: text.slice(i, i + size) });
  return chunks;
}

function key(target: IMDeliveryTarget): string {
  return `${target.transport}:${target.accountId ?? ""}:${target.target}:${target.threadId ?? ""}`;
}

function addUnique(targets: IMDeliveryTarget[], target: IMDeliveryTarget): void {
  const targetKey = key(target);
  if (!targets.some((existing) => key(existing) === targetKey)) targets.push(target);
}

function routeTargets(route: string, routes: Record<string, IMRouteConfig> = {}): IMDeliveryTarget[] {
  const configured = routes[route];
  if (!configured) throw new Error(`Unknown IM delivery route: ${route}`);
  return configured.targets.map((target) => ({
    transport: target.transport,
    target: target.target,
    accountId: target.accountId,
    contextToken: target.contextToken,
  }));
}

export function resolveDeliveryTargets(options: ResolveDeliveryTargetsOptions): IMDeliveryTarget[] {
  const includeFallback = options.includeFallback ?? true;
  const targets: IMDeliveryTarget[] = [];
  const fallback = options.fallbackDiscordTarget
    ? { transport: "discord" as const, target: options.fallbackDiscordTarget }
    : undefined;

  if (fallback && includeFallback && !options.extraOnly) addUnique(targets, fallback);
  if (options.route) {
    for (const target of routeTargets(options.route, options.routes)) addUnique(targets, target);
  }
  if (fallback && options.extraOnly) {
    return targets.filter((target) => key(target) !== key(fallback));
  }
  return targets;
}

function chunksForTransport(transport: IMTransportId, text: string): IMTextChunk[] {
  const normalized = text.trim() || "[empty message]";
  if (transport === "discord") {
    return chunkMessageWithDeferredLinkPreviews(normalized, "[empty message]").map((chunk) => ({
      content: chunk.content,
      suppressEmbeds: chunk.suppressEmbeds,
    }));
  }
  return chunkText(normalized, FEISHU_CHUNK_SIZE);
}

export async function sendTextToTargets(input: {
  targets: IMDeliveryTarget[];
  content: string;
  registry: IMTransportRegistry;
  metadata?: Record<string, unknown>;
  failOnError?: boolean;
}): Promise<IMDeliveryResult[]> {
  const results: IMDeliveryResult[] = [];
  for (const target of input.targets) {
    try {
      const transport = requireIMTransport(input.registry, target.transport);
      let lastMessage: SentMessage | undefined;
      for (const chunk of chunksForTransport(target.transport, input.content)) {
        lastMessage = await transport.send({
          target,
          content: chunk.content,
          suppressEmbeds: chunk.suppressEmbeds,
          metadata: input.metadata,
        });
      }
      results.push({ target, message: lastMessage });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      results.push({ target, error });
      if (input.failOnError ?? true) throw error;
    }
  }
  return results;
}

export async function sendTextFanout(input: {
  client?: Client;
  registry?: IMTransportRegistry;
  imConfig?: IMRuntimeConfig;
  fallbackDiscordTarget?: string;
  route?: string;
  content: string;
  extraOnly?: boolean;
  metadata?: Record<string, unknown>;
  failOnError?: boolean;
}): Promise<IMDeliveryResult[]> {
  const imConfig = input.imConfig ?? (input.route ? (await import("../config.js")).config.im : undefined);
  const registry = input.registry ?? createIMTransportRegistry(input.client, imConfig);
  const targets = resolveDeliveryTargets({
    route: input.route,
    fallbackDiscordTarget: input.fallbackDiscordTarget,
    extraOnly: input.extraOnly,
    routes: imConfig?.routes,
  });
  if (!targets.length) throw new Error("No IM delivery target resolved");
  return await sendTextToTargets({
    targets,
    content: input.content,
    registry,
    metadata: input.metadata,
    failOnError: input.failOnError,
  });
}

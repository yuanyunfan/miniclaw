import { createLogger } from "../lib/log.js";
import { createConfigReader } from "./env.js";
import { assertE2eIsolation, assertE2eRuntimePath } from "./e2e-guard.js";
import { loadRuntimeConfigSource } from "./load.js";
import { buildAgentRuntimeConfig } from "./domains/agent.js";
import { buildAgentRunManagerRuntimeConfig } from "./domains/agent-run-manager.js";
import { buildAttachmentRuntimeConfig } from "./domains/attachments.js";
import { buildCronRuntimeConfig } from "./domains/cron.js";
import { buildE2eRuntimeConfig } from "./domains/e2e.js";
import { buildIMRuntimeConfig } from "./domains/im.js";
import { buildMcpRuntimeConfig } from "./domains/mcp.js";
import { buildModelRuntimeConfig } from "./domains/model.js";
import { buildOperationalRuntimeConfig } from "./domains/operations.js";
import { applyProviderBaseUrlEnv, buildProviderRuntimeConfig } from "./domains/providers.js";
import { buildRoutingRuntimeConfig } from "./domains/routing.js";
import { buildStorageRuntimeConfig } from "./domains/storage.js";
import { buildTaskRuntimeConfig } from "./domains/tasks.js";

const log = createLogger("config");

export type DeepReadonly<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return value;
  seen.add(value);

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

export function createRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const configSource = loadRuntimeConfigSource(env);
  const reader = createConfigReader(configSource.data, env);

  const agent = buildAgentRuntimeConfig(reader);
  const agentRunManager = buildAgentRunManagerRuntimeConfig(reader);
  const model = buildModelRuntimeConfig(reader);
  const provider = buildProviderRuntimeConfig(reader, agent.agentProvider);
  const routing = buildRoutingRuntimeConfig(reader, model.modelClient.defaultClient);
  const storage = buildStorageRuntimeConfig(reader);
  const e2e = buildE2eRuntimeConfig(reader);
  const cron = buildCronRuntimeConfig(reader);
  const operations = buildOperationalRuntimeConfig(reader, e2e.mode);
  const attachments = buildAttachmentRuntimeConfig(reader);
  const im = buildIMRuntimeConfig(reader);

  applyProviderBaseUrlEnv(provider, env);

  if (!routing.autoReplyChannelIds.length) {
    log.warn("auto_reply_channels 已禁用，普通频道消息需 @mention 触发");
  }
  const discordEnabled = im.im.transports.discord.enabled;
  const discordRequiredString = (paths: Parameters<typeof reader.requiredString>[0], envKeys: Parameters<typeof reader.requiredString>[1]): string =>
    discordEnabled ? reader.requiredString(paths, envKeys) : reader.optionalString(paths, envKeys) ?? "";

  const runtimeConfig = {
    configFile: {
      path: configSource.path,
      loaded: configSource.loaded,
    },
    discord: {
      token: discordRequiredString(["discord", "token"], "DISCORD_TOKEN"),
      clientId: discordRequiredString(["discord", "client_id"], "DISCORD_CLIENT_ID"),
      guildId: discordRequiredString(["discord", "guild_id"], "DISCORD_GUILD_ID"),
    },
    ...agent,
    agentRunManager,
    ...model,
    ...im,
    ...provider,
    allowedUserId: discordRequiredString(["discord", "allowed_user_id"], "MINICLAW_ALLOWED_USER_ID"),
    mcp: buildMcpRuntimeConfig(reader),
    ...routing,
    tasks: buildTaskRuntimeConfig(reader),
    ...cron,
    ...storage,
    e2e,
    ...operations,
    ...attachments,
  } as const;

  assertE2eIsolation({
    e2eMode: runtimeConfig.e2e.mode,
    configuredConfigPath: configSource.configuredPath,
    configPath: configSource.path,
    senderUserIds: runtimeConfig.e2e.senderUserIds,
    disableScheduler: runtimeConfig.e2e.disableScheduler,
    fakeAgent: runtimeConfig.e2e.fakeAgent,
    dbPath: runtimeConfig.dbPath,
    memoryPath: runtimeConfig.memoryPath,
    defaultCwd: runtimeConfig.defaultCwd,
    channelDefaults: runtimeConfig.channelDefaults,
    tempRoot: runtimeConfig.e2e.tempRoot,
  });

  return deepFreeze(runtimeConfig);
}

export type RuntimeConfig = ReturnType<typeof createRuntimeConfig>;

export const config = createRuntimeConfig();

export function assertE2eSafeRuntimePath(kind: string, path: string): void {
  assertE2eRuntimePath(kind, path, config.e2e.mode, config.e2e.tempRoot);
}

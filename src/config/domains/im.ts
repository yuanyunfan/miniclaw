import type { ConfigReader } from "../env.js";
import { imTransportValues, isPlainObject } from "../schema.js";
import type { IMRouteConfig, IMRouteTargetConfig, IMTransportId } from "../types.js";

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseTarget(value: unknown, routeName: string, index: number): IMRouteTargetConfig {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid config im.routes.${routeName}.targets[${index}]: expected object`);
  }
  const transport = cleanName(value.transport)?.toLowerCase();
  if (!transport || !(imTransportValues as readonly string[]).includes(transport)) {
    throw new Error(`Invalid config im.routes.${routeName}.targets[${index}].transport: expected one of ${imTransportValues.join(", ")}`);
  }
  const target = cleanName(value.target);
  if (!target) {
    throw new Error(`Invalid config im.routes.${routeName}.targets[${index}].target: expected non-empty string`);
  }
  const accountId = cleanName(value.account_id) ?? cleanName(value.accountId);
  const contextToken = cleanName(value.context_token) ?? cleanName(value.contextToken);
  return {
    transport: transport as IMTransportId,
    target,
    ...(accountId ? { accountId } : {}),
    ...(contextToken ? { contextToken } : {}),
  };
}

function parseRoute(value: unknown, routeName: string): IMRouteConfig {
  const route = isPlainObject(value) && Array.isArray(value.targets)
    ? value.targets
    : Array.isArray(value)
      ? value
      : undefined;
  if (!route?.length) {
    throw new Error(`Invalid config im.routes.${routeName}: expected non-empty targets array`);
  }
  return {
    targets: route.map((target, index) => parseTarget(target, routeName, index)),
  };
}

function parseRoutes(raw: unknown): Record<string, IMRouteConfig> {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) throw new Error("Invalid config im.routes: expected object");
  const routes: Record<string, IMRouteConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    const routeName = name.trim();
    if (!routeName) throw new Error("Invalid config im.routes: route name cannot be empty");
    routes[routeName] = parseRoute(value, routeName);
  }
  return routes;
}

export function buildIMRuntimeConfig(reader: ConfigReader) {
  return {
    im: {
      defaultTransport: reader.oneOf<IMTransportId>(
        [["im", "default_transport"], ["im", "defaultTransport"]],
        "MINICLAW_IM_DEFAULT_TRANSPORT",
        "discord",
        imTransportValues
      ),
      transports: {
        discord: {
          enabled: reader.boolValue(["im", "transports", "discord", "enabled"], "MINICLAW_IM_DISCORD_ENABLED", true),
        },
        feishu: {
          enabled: reader.boolValue(["im", "transports", "feishu", "enabled"], "MINICLAW_IM_FEISHU_ENABLED", false),
          webhookUrl: reader.optionalString(
            [["im", "transports", "feishu", "webhook_url"], ["im", "transports", "feishu", "webhookUrl"]],
            "MINICLAW_FEISHU_WEBHOOK_URL"
          ),
          secret: reader.optionalString(["im", "transports", "feishu", "secret"], "MINICLAW_FEISHU_SECRET"),
        },
        weixin: {
          enabled: reader.boolValue(["im", "transports", "weixin", "enabled"], "MINICLAW_IM_WEIXIN_ENABLED", false),
          pollEnabled: reader.boolValue(
            [["im", "transports", "weixin", "poll_enabled"], ["im", "transports", "weixin", "pollEnabled"]],
            "MINICLAW_WEIXIN_POLL_ENABLED",
            false
          ),
          stateDir: reader.optionalString(
            [["im", "transports", "weixin", "state_dir"], ["im", "transports", "weixin", "stateDir"]],
            "MINICLAW_WEIXIN_STATE_DIR"
          ),
          defaultAccountId: reader.optionalString(
            [["im", "transports", "weixin", "default_account_id"], ["im", "transports", "weixin", "defaultAccountId"]],
            "MINICLAW_WEIXIN_ACCOUNT_ID"
          ),
          allowedUserIds: reader.stringArray(
            [["im", "transports", "weixin", "allow_from"], ["im", "transports", "weixin", "allowed_user_ids"], ["im", "transports", "weixin", "allowedUserIds"]],
            "MINICLAW_WEIXIN_ALLOW_FROM"
          ),
          taskBridgeChannelId: reader.optionalString(
            [["im", "transports", "weixin", "task_bridge_channel_id"], ["im", "transports", "weixin", "taskBridgeChannelId"]],
            "MINICLAW_WEIXIN_TASK_BRIDGE_CHANNEL_ID"
          ),
        },
      },
      routes: parseRoutes(reader.getPath(["im", "routes"])),
    },
  } as const;
}

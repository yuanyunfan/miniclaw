import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { loadWechatMpSession } from "./auth.js";
import { HttpWechatMpClient } from "./client.js";
import { collectWechatMpArticles, type CollectedWechatMpProviderData } from "./collector.js";
import { loadWechatMpProviderConfig } from "./config.js";
import { sanitizeWechatMpError, WechatMpInvalidSessionError } from "./errors.js";
import { formatWechatMpCollectResult } from "./format.js";
import type { WechatMpClient, WechatMpProviderConfig, WechatMpSession } from "./types.js";

export interface WechatMpProviderDeps {
  loadConfig?: (name?: string) => WechatMpProviderConfig;
  loadSession?: (path: string) => WechatMpSession;
  createClient?: (session: WechatMpSession) => WechatMpClient;
  collect?: (
    config: WechatMpProviderConfig,
    client: WechatMpClient,
    options: { now: Date },
  ) => Promise<CollectedWechatMpProviderData>;
}

function configName(args: PreProviderRunArgs): string {
  return args.configName ?? "default";
}

export function buildWechatMpLoginRequiredMessage(args: PreProviderRunArgs, err: unknown): string {
  const name = configName(args);
  const error = sanitizeWechatMpError(err);
  return [
    `⏰ cron \`${args.jobName}\` ⚠️ 微信公众号后台登录态已失效，已跳过本次汇总，避免输出空数据。`,
    "",
    "需要在 MiniClaw 机器上重新登录后再采集：",
    "",
    "```bash",
    "# 在 MiniClaw 项目目录运行",
    `pnpm wechat-mp:login -- --config ${name}`,
    `pnpm wechat-mp:check -- --config ${name}`,
    "```",
    "",
    `原因: ${error}`,
  ].join("\n");
}

function buildInvalidSessionPayload(args: PreProviderRunArgs, err: unknown): string {
  return JSON.stringify({
    generated_at: args.runAt.toISOString(),
    source: "wechat-mp",
    profile: configName(args),
    status: "skipped",
    skip_reason: "wechat_mp_session_invalid",
    error: sanitizeWechatMpError(err),
    total_articles: 0,
  }, null, 2);
}

export async function runWechatMpProvider(
  args: PreProviderRunArgs,
  deps: WechatMpProviderDeps = {},
): Promise<PreProviderResult> {
  const loadConfig = deps.loadConfig ?? loadWechatMpProviderConfig;
  const loadSession = deps.loadSession ?? loadWechatMpSession;
  const createClient = deps.createClient ?? ((session: WechatMpSession) => new HttpWechatMpClient(session));
  const collect = deps.collect ?? collectWechatMpArticles;

  try {
    const config = loadConfig(args.configName);
    const session = loadSession(config.auth_path);
    const client = createClient(session);
    const collected = await collect(config, client, { now: args.runAt });
    return {
      text: formatWechatMpCollectResult(collected.result),
      commit: collected.commit,
    };
  } catch (err) {
    if (err instanceof WechatMpInvalidSessionError) {
      return {
        text: buildInvalidSessionPayload(args, err),
        skipTask: {
          reason: "wechat_mp_session_invalid",
          message: sanitizeWechatMpError(err),
          notifyMessage: buildWechatMpLoginRequiredMessage(args, err),
        },
      };
    }
    throw err;
  }
}

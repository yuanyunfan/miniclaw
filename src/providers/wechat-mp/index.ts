import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { loadWechatMpSession } from "./auth.js";
import { HttpWechatMpClient } from "./client.js";
import { collectWechatMpArticles } from "./collector.js";
import { loadWechatMpProviderConfig } from "./config.js";
import { formatWechatMpCollectResult } from "./format.js";

export async function runWechatMpProvider(args: PreProviderRunArgs): Promise<PreProviderResult> {
  const config = loadWechatMpProviderConfig(args.configName);
  const session = loadWechatMpSession(config.auth_path);
  const client = new HttpWechatMpClient(session);
  const collected = await collectWechatMpArticles(config, client, { now: args.runAt });
  return {
    text: formatWechatMpCollectResult(collected.result),
    commit: collected.commit,
  };
}

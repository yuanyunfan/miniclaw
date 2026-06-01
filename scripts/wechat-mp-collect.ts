#!/usr/bin/env tsx
import { loadWechatMpSession } from "../src/providers/wechat-mp/auth.js";
import { HttpWechatMpClient } from "../src/providers/wechat-mp/client.js";
import { collectWechatMpArticles } from "../src/providers/wechat-mp/collector.js";
import { loadWechatMpProviderConfig } from "../src/providers/wechat-mp/config.js";
import { createWechatMpArticleContentFetcher } from "../src/providers/wechat-mp/content.js";
import { sanitizeWechatMpError } from "../src/providers/wechat-mp/errors.js";
import { formatWechatMpCollectResult } from "../src/providers/wechat-mp/format.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

try {
  const configName = argValue("config") ?? "default";
  const dryRun = process.argv.includes("--dry-run");
  const cfg = loadWechatMpProviderConfig(configName);
  const session = loadWechatMpSession(cfg.auth_path);
  const client = new HttpWechatMpClient(session);
  const collected = await collectWechatMpArticles(cfg, client, {
    contentFetcher: createWechatMpArticleContentFetcher(session),
  });
  console.log(formatWechatMpCollectResult(collected.result));
  if (!dryRun) await collected.commit();
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: sanitizeWechatMpError(err) }, null, 2));
  process.exit(1);
}

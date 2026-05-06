#!/usr/bin/env tsx
import { loadWechatMpSession, redactSessionForLog } from "../src/providers/wechat-mp/auth.js";
import { HttpWechatMpClient } from "../src/providers/wechat-mp/client.js";
import { loadWechatMpProviderConfig } from "../src/providers/wechat-mp/config.js";
import { sanitizeWechatMpError } from "../src/providers/wechat-mp/errors.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

try {
  const configName = argValue("config") ?? "default";
  const cfg = loadWechatMpProviderConfig(configName);
  const session = loadWechatMpSession(cfg.auth_path);
  const client = new HttpWechatMpClient(session);
  const query = argValue("query") ?? cfg.accounts[0]?.query ?? "阿里云开发者";
  const results = await client.searchBiz(query);
  console.log(JSON.stringify({
    ok: true,
    query,
    result_count: results.length,
    session: redactSessionForLog(session),
  }, null, 2));
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: sanitizeWechatMpError(err) }, null, 2));
  process.exit(1);
}

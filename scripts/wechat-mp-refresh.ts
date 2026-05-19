#!/usr/bin/env tsx
import {
  formatAuthSessionRefreshResults,
  runWechatMpSessionRefresh,
} from "../src/ops/auth-session-refresh.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

const configName = argValue("config") ?? "default";
const timeoutMs = Number(argValue("timeout-ms") ?? "30000");
const result = await runWechatMpSessionRefresh(configName, {
  headless: !hasArg("--visible"),
  timeoutMs,
  checkQuery: argValue("check-query"),
});

if (hasArg("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatAuthSessionRefreshResults([result]));
}

if (result.status !== "refreshed") {
  process.exit(1);
}

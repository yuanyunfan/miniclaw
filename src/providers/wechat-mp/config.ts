import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { resolveHome } from "./auth.js";
import type { WechatMpProviderConfig } from "./types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/wechat-mp");
const DEFAULT_AUTH_PATH = "~/.miniclaw/secrets/wechat-mp-session.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getConfigDir(): string {
  return process.env.MINICLAW_WECHAT_MP_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

export function getWechatMpConfigPath(name = "default"): string {
  if (name.includes("/") || name.includes("..")) {
    throw new Error("wechat-mp config name must not include path separators");
  }
  const file = name.endsWith(".yaml") || name.endsWith(".yml") ? name : `${name}.yaml`;
  return resolveHome(join(getConfigDir(), file));
}

export function loadWechatMpProviderConfig(name?: string): WechatMpProviderConfig {
  const path = getWechatMpConfigPath(name ?? "default");
  if (!existsSync(path)) throw new Error(`wechat-mp config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8"));
  if (!isPlainObject(raw)) throw new Error(`wechat-mp config must be a YAML object: ${path}`);

  const accountsRaw = Array.isArray(raw.accounts) ? raw.accounts : [];
  const accounts = accountsRaw
    .filter(isPlainObject)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name.trim() : "",
      query: typeof item.query === "string" ? item.query.trim() : "",
      alias: typeof item.alias === "string" && item.alias.trim() ? item.alias.trim() : undefined,
      fakeid: typeof item.fakeid === "string" && item.fakeid.trim() ? item.fakeid.trim() : undefined,
    }))
    .filter((item) => item.name && item.query);
  if (!accounts.length) throw new Error(`wechat-mp config must include at least one account: ${path}`);

  return {
    auth_path: typeof raw.auth_path === "string" ? raw.auth_path : DEFAULT_AUTH_PATH,
    state_path: typeof raw.state_path === "string" ? raw.state_path : "~/.miniclaw/providers/wechat-mp/state.json",
    window_hours: positiveInt(raw.window_hours, 24),
    max_pages_per_account: positiveInt(raw.max_pages_per_account, 1),
    page_size: positiveInt(raw.page_size, 10),
    dedupe: bool(raw.dedupe, true),
    accounts,
  };
}

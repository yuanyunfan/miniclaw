import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { resolveHome } from "./auth.js";
import type { WechatMpFixedWindowSlot, WechatMpProviderConfig, WechatMpWindowConfig } from "./types.js";

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

function hour(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error(`wechat-mp config window.${field} must be an integer hour 0-23`);
  }
  return value;
}

function dayOffset(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -7 || value > 7) {
    throw new Error(`wechat-mp config window.${field} must be an integer day offset between -7 and 7`);
  }
  return value;
}

function parseWindow(raw: Record<string, unknown>, fallbackHours: number): WechatMpWindowConfig {
  const windowRaw = raw.window;
  if (!isPlainObject(windowRaw)) return { mode: "relative", hours: fallbackHours };
  const mode = windowRaw.mode;
  if (mode === "relative") {
    return { mode: "relative", hours: positiveInt(windowRaw.hours, fallbackHours) };
  }
  if (mode !== "fixed_slots") {
    throw new Error("wechat-mp config window.mode must be relative or fixed_slots");
  }
  const timezoneOffset = typeof windowRaw.timezone_offset_hours === "number"
    ? windowRaw.timezone_offset_hours
    : 8;
  if (!Number.isFinite(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 14) {
    throw new Error("wechat-mp config window.timezone_offset_hours must be between -12 and 14");
  }
  if (!Array.isArray(windowRaw.slots)) {
    throw new Error("wechat-mp config window.fixed_slots requires slots");
  }
  const slots: WechatMpFixedWindowSlot[] = windowRaw.slots
    .map((slot) => {
      if (!isPlainObject(slot)) {
        throw new Error("wechat-mp config window.slots[] must be an object");
      }
      return {
        at_hour: hour(slot.at_hour, "slots[].at_hour"),
        start_day_offset: dayOffset(slot.start_day_offset, "slots[].start_day_offset"),
        start_hour: hour(slot.start_hour, "slots[].start_hour"),
        end_day_offset: dayOffset(slot.end_day_offset, "slots[].end_day_offset"),
        end_hour: hour(slot.end_hour, "slots[].end_hour"),
      };
    });
  if (!slots.length) throw new Error("wechat-mp config window.fixed_slots requires at least one slot");
  return { mode: "fixed_slots", timezone_offset_hours: timezoneOffset, slots };
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

  const windowHours = positiveInt(raw.window_hours, 24);
  return {
    auth_path: typeof raw.auth_path === "string" ? raw.auth_path : DEFAULT_AUTH_PATH,
    state_path: typeof raw.state_path === "string" ? raw.state_path : "~/.miniclaw/providers/wechat-mp/state.json",
    window_hours: windowHours,
    window: parseWindow(raw, windowHours),
    max_pages_per_account: positiveInt(raw.max_pages_per_account, 1),
    page_size: positiveInt(raw.page_size, 10),
    dedupe: bool(raw.dedupe, true),
    accounts,
  };
}

import type { EastmoneyJywgProfileConfig } from "./types.js";
import { EastmoneyJywgForbiddenEndpointError } from "./errors.js";

export const EASTMONEY_JYWG_TOOL_NAMES = [
  "eastmoney_jywg_health_check",
  "eastmoney_jywg_get_account_snapshot",
  "eastmoney_jywg_get_positions_summary",
  "eastmoney_jywg_get_daily_pnl_report",
] as const;

export type EastmoneyJywgToolName = typeof EASTMONEY_JYWG_TOOL_NAMES[number];

export const FORBIDDEN_EASTMONEY_JYWG_ENDPOINTS = [
  "SubmitTradeV2",
  "SubmitBatTradeV2",
  "RevokeOrders",
  "GetCanBuyNewStockList",
  "GetConvertibleBondList",
] as const;

const FORBIDDEN_TOOL_NAME_PARTS = ["order", "trade", "buy", "sell", "cancel", "revoke", "submit", "ipo", "unlock"] as const;
const JYWG_HOST = "jywg.18.cn";

export const EASTMONEY_JYWG_ENDPOINTS = {
  trade_buy: { method: "GET", path: "/Trade/Buy", requiresValidateKey: false },
  query_asset_and_position: { method: "POST", path: "/Com/queryAssetAndPositionV1", requiresValidateKey: true },
  query_positions: { method: "POST", path: "/Search/GetStockList", requiresValidateKey: true },
  query_orders: { method: "POST", path: "/Search/GetOrdersData", requiresValidateKey: true },
  query_deals: { method: "POST", path: "/Search/GetDealData", requiresValidateKey: true },
} as const;

export type EastmoneyJywgEndpointName = keyof typeof EASTMONEY_JYWG_ENDPOINTS;

export function assertAllowedToolName(name: string): asserts name is EastmoneyJywgToolName {
  if (!EASTMONEY_JYWG_TOOL_NAMES.includes(name as EastmoneyJywgToolName)) {
    throw new Error(`unknown eastmoney-jywg tool: ${name}`);
  }
  const lower = name.toLowerCase();
  const blocked = FORBIDDEN_TOOL_NAME_PARTS.find((part) => lower.includes(part));
  if (blocked) throw new Error(`eastmoney-jywg tool name must not include '${blocked}': ${name}`);
}

export function assertSafeBaseUrl(profile: EastmoneyJywgProfileConfig): void {
  const url = new URL(profile.base_url);
  if (url.protocol !== "https:" || url.hostname !== JYWG_HOST) {
    if (!profile.allow_non_jywg_host) {
      throw new Error("eastmoney-jywg refuses non-jywg host by default; base_url must be https://jywg.18.cn");
    }
  }
}

export function assertAllowedEndpointName(name: string): asserts name is EastmoneyJywgEndpointName {
  if (!(name in EASTMONEY_JYWG_ENDPOINTS)) {
    throw new EastmoneyJywgForbiddenEndpointError(`unknown eastmoney-jywg endpoint: ${name}`);
  }
}

export function buildEndpointUrl(
  profile: EastmoneyJywgProfileConfig,
  endpointName: EastmoneyJywgEndpointName,
  validateKey?: string,
): URL {
  assertSafeBaseUrl(profile);
  assertAllowedEndpointName(endpointName);
  const endpoint = EASTMONEY_JYWG_ENDPOINTS[endpointName];
  const url = new URL(endpoint.path, profile.base_url);
  if (url.protocol !== "https:" || url.hostname !== JYWG_HOST) {
    if (!profile.allow_non_jywg_host) {
      throw new EastmoneyJywgForbiddenEndpointError(`blocked eastmoney-jywg host: ${url.hostname}`);
    }
  }
  if (endpoint.requiresValidateKey) {
    if (!validateKey) throw new Error(`${endpointName} requires validatekey`);
    url.searchParams.set("validatekey", validateKey);
  }
  return url;
}

export function assertSafeRedirect(location: string | null, baseUrl: string): void {
  if (!location) return;
  const target = new URL(location, baseUrl);
  if (target.protocol !== "https:" || target.hostname !== JYWG_HOST) {
    throw new EastmoneyJywgForbiddenEndpointError(`blocked eastmoney-jywg redirect host: ${target.hostname}`);
  }
}

export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(validatekey=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/(em_validatekey["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

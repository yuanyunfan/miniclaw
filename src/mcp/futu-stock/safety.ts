import type { FutuStockProfileConfig } from "./types.js";

export const FUTU_STOCK_TOOL_NAMES = [
  "futu_health_check",
  "futu_get_account_snapshot",
  "futu_get_positions_summary",
  "futu_get_daily_pnl_report",
] as const;

export type FutuStockToolName = typeof FUTU_STOCK_TOOL_NAMES[number];

export const FORBIDDEN_FUTU_API_NAMES = [
  "unlock_trade",
  "place_order",
  "modify_order",
  "trade_unlock",
  "order_create",
  "order_modify",
  "cancel_order",
] as const;

const FORBIDDEN_TOOL_NAME_PARTS = ["unlock", "order", "buy", "sell"] as const;
const LOCAL_OPEND_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertAllowedToolName(name: string): asserts name is FutuStockToolName {
  if (!FUTU_STOCK_TOOL_NAMES.includes(name as FutuStockToolName)) {
    throw new Error(`unknown futu-stock tool: ${name}`);
  }
  const lower = name.toLowerCase();
  const blocked = FORBIDDEN_TOOL_NAME_PARTS.find((part) => lower.includes(part));
  if (blocked) throw new Error(`futu-stock tool name must not include '${blocked}': ${name}`);
}

export function assertSafeOpendHost(profile: FutuStockProfileConfig): void {
  const host = profile.opend_host.trim().toLowerCase();
  if (!LOCAL_OPEND_HOSTS.has(host) && !profile.allow_non_local_opend) {
    throw new Error("futu-stock refuses non-local OpenD host by default; use 127.0.0.1 or explicitly enable allow_non_local_opend");
  }
}

export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .replace(/(password|token|cookie|secret|acc_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .slice(0, 800);
}

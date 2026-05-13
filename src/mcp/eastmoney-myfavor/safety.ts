import type { EastmoneyMyfavorProfileConfig } from "./types.js";

const MYFAVOR_HOST = "myfavor.eastmoney.com";

export const EASTMONEY_MYFAVOR_ENDPOINTS = {
  groups: "/v4/webouter/ggdefstkindexinfos",
  securities: "/v4/webouter/gstkinfos",
} as const;

export const FORBIDDEN_EASTMONEY_MYFAVOR_ENDPOINT_PARTS = [
  "/ag",
  "/mg",
  "/dg",
  "/as",
  "/ds",
] as const;

export type EastmoneyMyfavorEndpointName = keyof typeof EASTMONEY_MYFAVOR_ENDPOINTS;

export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id|appkey)\s*[:=]\s*[^,\s}&]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

export function assertSafeBaseUrl(profile: EastmoneyMyfavorProfileConfig): void {
  const url = new URL(profile.base_url);
  if (url.protocol !== "https:" || url.hostname !== MYFAVOR_HOST) {
    throw new Error("eastmoney-myfavor base_url must be https://myfavor.eastmoney.com");
  }
}

export function buildEndpointUrl(
  profile: EastmoneyMyfavorProfileConfig,
  endpointName: EastmoneyMyfavorEndpointName,
  params: Record<string, string>,
): URL {
  assertSafeBaseUrl(profile);
  const path = EASTMONEY_MYFAVOR_ENDPOINTS[endpointName];
  if (FORBIDDEN_EASTMONEY_MYFAVOR_ENDPOINT_PARTS.some((part) => path.endsWith(part))) {
    throw new Error(`blocked eastmoney-myfavor endpoint: ${path}`);
  }
  const url = new URL(path, profile.base_url);
  if (url.protocol !== "https:" || url.hostname !== MYFAVOR_HOST) {
    throw new Error(`blocked eastmoney-myfavor host: ${url.hostname}`);
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

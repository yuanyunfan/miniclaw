import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { WechatMpCookie, WechatMpSession } from "./types.js";
import { WechatMpInvalidSessionError } from "./errors.js";

export function resolveHome(path: string): string {
  return path.startsWith("~") ? resolve(homedir(), path.slice(2)) : resolve(path);
}

function isCookie(value: unknown): value is WechatMpCookie {
  const c = value as WechatMpCookie;
  return Boolean(c && typeof c.name === "string" && c.name && typeof c.value === "string");
}

export function parseWechatMpSession(raw: unknown): WechatMpSession {
  const obj = raw as Partial<WechatMpSession>;
  if (!obj || typeof obj !== "object") {
    throw new WechatMpInvalidSessionError("wechat mp session file must be a JSON object");
  }
  if (typeof obj.token !== "string" || !/^\d+$/.test(obj.token)) {
    throw new WechatMpInvalidSessionError("wechat mp session token is missing or invalid");
  }
  if (!Array.isArray(obj.cookies) || obj.cookies.length === 0 || !obj.cookies.every(isCookie)) {
    throw new WechatMpInvalidSessionError("wechat mp session cookies are missing or invalid");
  }
  return {
    token: obj.token,
    cookies: obj.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
    })),
    saved_at: typeof obj.saved_at === "string" ? obj.saved_at : undefined,
    source_url: typeof obj.source_url === "string" ? obj.source_url : undefined,
  };
}

export function loadWechatMpSession(path: string): WechatMpSession {
  const resolved = resolveHome(path);
  if (!existsSync(resolved)) {
    throw new WechatMpInvalidSessionError(`wechat mp session file not found: ${resolved}`);
  }
  const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
  return parseWechatMpSession(raw);
}

export function saveWechatMpSession(path: string, session: WechatMpSession): void {
  const resolved = resolveHome(path);
  const dir = dirname(resolved);
  mkdirSync(dir, { recursive: true });
  const tmp = resolve(dir, `.${basename(resolved)}.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(parseWechatMpSession(session), null, 2), "utf8");
  chmodSync(tmp, 0o600);
  renameSync(tmp, resolved);
}

export function tokenFromWechatMpUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const token = url.searchParams.get("token");
    return token && /^\d+$/.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

export function filterWechatMpCookies(cookies: WechatMpCookie[]): WechatMpCookie[] {
  return cookies.filter((cookie) => {
    const domain = (cookie.domain ?? "").toLowerCase();
    return domain.includes("mp.weixin.qq.com") || domain.includes("weixin.qq.com") || domain.includes("qq.com");
  });
}

export function buildCookieHeader(cookies: WechatMpCookie[]): string {
  const pairs = cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`);
  if (!pairs.length) throw new WechatMpInvalidSessionError("wechat mp session has no usable cookies");
  return pairs.join("; ");
}

export function redactSessionForLog(session: WechatMpSession): Record<string, unknown> {
  return {
    token: "<redacted>",
    cookie_count: session.cookies.length,
    saved_at: session.saved_at,
    source_url: session.source_url ? session.source_url.replace(/token=\d+/g, "token=<redacted>") : undefined,
  };
}

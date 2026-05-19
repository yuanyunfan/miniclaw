import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { EastmoneyJywgCookie, EastmoneyJywgSession } from "./types.js";
import { EastmoneyJywgInvalidSessionError } from "./errors.js";

export function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function isCookie(value: unknown): value is EastmoneyJywgCookie {
  const c = value as EastmoneyJywgCookie;
  return Boolean(c && typeof c.name === "string" && c.name.trim() && typeof c.value === "string");
}

function normalizeCookie(cookie: EastmoneyJywgCookie): EastmoneyJywgCookie {
  return {
    name: cookie.name.trim(),
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
}

export function parseEastmoneyJywgSession(raw: unknown): EastmoneyJywgSession {
  const obj = raw as Partial<EastmoneyJywgSession>;
  if (!obj || typeof obj !== "object") {
    throw new EastmoneyJywgInvalidSessionError("eastmoney-jywg session file must be a JSON object");
  }
  if (obj.version !== 1) {
    throw new EastmoneyJywgInvalidSessionError("eastmoney-jywg session version must be 1");
  }
  if (obj.host !== "jywg.18.cn") {
    throw new EastmoneyJywgInvalidSessionError("eastmoney-jywg session host must be jywg.18.cn");
  }
  if (!Array.isArray(obj.cookies) || !obj.cookies.length || !obj.cookies.every(isCookie)) {
    throw new EastmoneyJywgInvalidSessionError("eastmoney-jywg session cookies are missing or invalid");
  }
  return {
    version: 1,
    profile: typeof obj.profile === "string" && obj.profile.trim() ? obj.profile.trim() : undefined,
    host: "jywg.18.cn",
    created_at: typeof obj.created_at === "string" ? obj.created_at : undefined,
    last_verified_at: typeof obj.last_verified_at === "string" ? obj.last_verified_at : undefined,
    expires_at_hint: typeof obj.expires_at_hint === "string" ? obj.expires_at_hint : undefined,
    source: typeof obj.source === "string" ? obj.source : undefined,
    cookies: obj.cookies.map(normalizeCookie),
    fingerprint: obj.fingerprint,
  };
}

export function assertSessionFileMode(path: string): void {
  if (process.platform === "win32") return;
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    throw new EastmoneyJywgInvalidSessionError(`eastmoney-jywg session file must have 0600 permissions: ${path}`);
  }
}

export function loadEastmoneyJywgSession(path: string): EastmoneyJywgSession {
  const resolved = resolveHome(path);
  if (!existsSync(resolved)) {
    throw new EastmoneyJywgInvalidSessionError(`eastmoney-jywg session file not found: ${resolved}`);
  }
  assertSessionFileMode(resolved);
  const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
  return parseEastmoneyJywgSession(raw);
}

export function saveEastmoneyJywgSession(path: string, session: EastmoneyJywgSession): void {
  const resolved = resolveHome(path);
  const dir = dirname(resolved);
  mkdirSync(dir, { recursive: true });
  const tmp = resolve(dir, `.eastmoney-jywg-session.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(parseEastmoneyJywgSession(session), null, 2), "utf8");
  chmodSync(tmp, 0o600);
  renameSync(tmp, resolved);
}

export function buildCookieHeader(cookies: EastmoneyJywgCookie[]): string {
  const pairs = cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  if (!pairs.length) throw new EastmoneyJywgInvalidSessionError("eastmoney-jywg session has no usable cookies");
  return pairs.join("; ");
}

export function filterJywgCookies(cookies: EastmoneyJywgCookie[]): EastmoneyJywgCookie[] {
  return cookies.filter((cookie) => {
    const domain = (cookie.domain ?? "").toLowerCase();
    return domain === "jywg.18.cn" || domain === ".jywg.18.cn" || domain === ".18.cn" || domain === "18.cn";
  }).map(normalizeCookie);
}

function cookieKey(cookie: EastmoneyJywgCookie): string {
  return `${cookie.name};${cookie.domain ?? ""};${cookie.path ?? "/"}`;
}

export function mergeSessionCookies(
  session: EastmoneyJywgSession,
  cookies: EastmoneyJywgCookie[],
): EastmoneyJywgSession {
  const merged = new Map<string, EastmoneyJywgCookie>();
  for (const cookie of session.cookies) merged.set(cookieKey(cookie), cookie);
  for (const cookie of filterJywgCookies(cookies)) {
    if (!cookie.value) continue;
    merged.set(cookieKey(cookie), cookie);
  }
  return { ...session, cookies: [...merged.values()] };
}

export function touchSession(session: EastmoneyJywgSession, now = new Date()): EastmoneyJywgSession {
  return {
    ...session,
    last_verified_at: now.toISOString(),
  };
}

export function redactSessionForLog(session: EastmoneyJywgSession): Record<string, unknown> {
  return {
    host: session.host,
    profile: session.profile,
    cookie_count: session.cookies.length,
    created_at: session.created_at,
    last_verified_at: session.last_verified_at,
    source: session.source,
  };
}

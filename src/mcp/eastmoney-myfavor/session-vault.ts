import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { EastmoneyMyfavorCookie, EastmoneyMyfavorSession } from "./types.js";

export class EastmoneyMyfavorInvalidSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EastmoneyMyfavorInvalidSessionError";
  }
}

export function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function isCookie(value: unknown): value is EastmoneyMyfavorCookie {
  const cookie = value as EastmoneyMyfavorCookie;
  return Boolean(cookie && typeof cookie.name === "string" && cookie.name.trim() && typeof cookie.value === "string");
}

function normalizeCookie(cookie: EastmoneyMyfavorCookie): EastmoneyMyfavorCookie {
  return {
    name: cookie.name.trim(),
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
  };
}

export function parseEastmoneyMyfavorSession(raw: unknown): EastmoneyMyfavorSession {
  const obj = raw as Partial<EastmoneyMyfavorSession>;
  if (!obj || typeof obj !== "object") {
    throw new EastmoneyMyfavorInvalidSessionError("eastmoney-myfavor session file must be a JSON object");
  }
  if (obj.version !== 1) throw new EastmoneyMyfavorInvalidSessionError("eastmoney-myfavor session version must be 1");
  if (obj.host !== "myfavor.eastmoney.com") {
    throw new EastmoneyMyfavorInvalidSessionError("eastmoney-myfavor session host must be myfavor.eastmoney.com");
  }
  if (!Array.isArray(obj.cookies) || !obj.cookies.length || !obj.cookies.every(isCookie)) {
    throw new EastmoneyMyfavorInvalidSessionError("eastmoney-myfavor session cookies are missing or invalid");
  }
  return {
    version: 1,
    profile: typeof obj.profile === "string" && obj.profile.trim() ? obj.profile.trim() : undefined,
    host: "myfavor.eastmoney.com",
    created_at: typeof obj.created_at === "string" ? obj.created_at : undefined,
    last_verified_at: typeof obj.last_verified_at === "string" ? obj.last_verified_at : undefined,
    source: typeof obj.source === "string" ? obj.source : undefined,
    cookies: obj.cookies.map(normalizeCookie),
    fingerprint: obj.fingerprint,
  };
}

function assertSessionFileMode(path: string): void {
  if (process.platform === "win32") return;
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    throw new EastmoneyMyfavorInvalidSessionError(`eastmoney-myfavor session file must have 0600 permissions: ${path}`);
  }
}

export function loadEastmoneyMyfavorSession(path: string): EastmoneyMyfavorSession {
  const resolved = resolveHome(path);
  if (!existsSync(resolved)) {
    throw new EastmoneyMyfavorInvalidSessionError(`eastmoney-myfavor session file not found: ${resolved}`);
  }
  assertSessionFileMode(resolved);
  return parseEastmoneyMyfavorSession(JSON.parse(readFileSync(resolved, "utf8")) as unknown);
}

export function saveEastmoneyMyfavorSession(path: string, session: EastmoneyMyfavorSession): void {
  const resolved = resolveHome(path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(parseEastmoneyMyfavorSession(session), null, 2), "utf8");
  chmodSync(resolved, 0o600);
}

export function filterMyfavorCookies(cookies: EastmoneyMyfavorCookie[]): EastmoneyMyfavorCookie[] {
  return cookies.filter((cookie) => {
    const domain = (cookie.domain ?? "").toLowerCase();
    return domain === "myfavor.eastmoney.com"
      || domain === ".myfavor.eastmoney.com"
      || domain === ".eastmoney.com"
      || domain === "eastmoney.com";
  }).map(normalizeCookie);
}

export function buildCookieHeader(cookies: EastmoneyMyfavorCookie[]): string {
  const pairs = cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  if (!pairs.length) throw new EastmoneyMyfavorInvalidSessionError("eastmoney-myfavor session has no usable cookies");
  return pairs.join("; ");
}

export function touchSession(session: EastmoneyMyfavorSession, now = new Date()): EastmoneyMyfavorSession {
  return { ...session, last_verified_at: now.toISOString() };
}

import {
  EastmoneyJywgInvalidSessionError,
  EastmoneyJywgLoginChallengeError,
} from "./errors.js";
import {
  buildEndpointUrl,
  assertSafeRedirect,
  sanitizeError,
  type EastmoneyJywgEndpointName,
} from "./safety.js";
import {
  buildCookieHeader,
  filterJywgCookies,
  mergeSessionCookies,
  touchSession,
} from "./session-vault.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgClientOptions,
  EastmoneyJywgCookie,
  EastmoneyJywgHealthCheck,
  EastmoneyJywgProfileConfig,
  EastmoneyJywgRawBrokerData,
  EastmoneyJywgSession,
} from "./types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36";
const DEFAULT_FORM = { qqhs: "100", dwc: "" } as const;

function extractValidateKey(html: string): string {
  const match = html.match(/id=["']em_validatekey["'][^>]*value=["']([^"']+)["']/i)
    ?? html.match(/name=["']em_validatekey["'][^>]*value=["']([^"']+)["']/i);
  const key = match?.[1]?.trim();
  if (key) return key;
  if (/\/Login|identifyCode|YZM|验证码|短信|安全控件|登录/i.test(html)) {
    throw new EastmoneyJywgLoginChallengeError("eastmoney-jywg session requires visible browser re-authentication");
  }
  throw new EastmoneyJywgInvalidSessionError("eastmoney-jywg Trade/Buy did not expose em_validatekey");
}

function ensureNotLoginPage(text: string, context: string): void {
  if (/\/Login|identifyCode|YZM|验证码|短信|安全控件|登录/i.test(text) && !/em_validatekey/i.test(text)) {
    throw new EastmoneyJywgLoginChallengeError(`${context}: eastmoney-jywg returned a login challenge`);
  }
}

function statusNumber(payload: unknown): number | undefined {
  const obj = payload as Record<string, unknown>;
  const raw = obj?.Status ?? obj?.status;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function messageText(payload: unknown): string {
  const obj = payload as Record<string, unknown>;
  const raw = obj?.Message ?? obj?.message ?? obj?.msg ?? obj?.Msg;
  return typeof raw === "string" ? raw : "";
}

function assertJywgJson(payload: unknown, context: string): void {
  const status = statusNumber(payload);
  const message = messageText(payload);
  if (status === -2 || /会话已超时|重新登录|登录超时|未登录|session/i.test(message)) {
    throw new EastmoneyJywgInvalidSessionError(`${context}: eastmoney-jywg session expired`);
  }
  if (status !== undefined && status !== 0) {
    throw new Error(`${context}: eastmoney-jywg returned Status=${status}${message ? ` Message=${message}` : ""}`);
  }
}

function parseCookieExpires(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : undefined;
}

function splitSetCookieHeader(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim()).filter(Boolean);
}

function setCookieHeaders(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") return withGetter.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? splitSetCookieHeader(raw) : [];
}

function cookiesFromResponse(headers: Headers): EastmoneyJywgCookie[] {
  const cookies: EastmoneyJywgCookie[] = [];
  for (const header of setCookieHeaders(headers)) {
    const parts = header.split(";").map((part) => part.trim()).filter(Boolean);
    const [nameValue, ...attrs] = parts;
    const idx = nameValue.indexOf("=");
    if (idx <= 0) continue;
    const cookie: EastmoneyJywgCookie = {
      name: nameValue.slice(0, idx),
      value: nameValue.slice(idx + 1),
      domain: "jywg.18.cn",
      path: "/",
    };
    for (const attr of attrs) {
      const [keyRaw, valueRaw] = attr.split("=");
      const key = keyRaw.toLowerCase();
      const value = valueRaw;
      if (key === "domain" && value) cookie.domain = value.toLowerCase();
      else if (key === "path" && value) cookie.path = value;
      else if (key === "expires") cookie.expires = parseCookieExpires(value);
      else if (key === "secure") cookie.secure = true;
      else if (key === "httponly") cookie.httpOnly = true;
    }
    cookies.push(cookie);
  }
  return filterJywgCookies(cookies);
}

export class HttpEastmoneyJywgClient implements EastmoneyJywgClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async healthCheck(
    profile: EastmoneyJywgProfileConfig,
    session: EastmoneyJywgSession,
  ): Promise<EastmoneyJywgHealthCheck> {
    try {
      await this.getValidateKey(profile, session);
      return {
        ok: true,
        host: new URL(profile.base_url).hostname,
        session: {
          ok: true,
          cookie_count: session.cookies.length,
          last_verified_at: session.last_verified_at,
        },
      };
    } catch (err) {
      return {
        ok: false,
        host: new URL(profile.base_url).hostname,
        session: {
          ok: false,
          cookie_count: session.cookies.length,
          last_verified_at: session.last_verified_at,
          error: sanitizeError(err),
        },
      };
    }
  }

  async refreshSession(
    profile: EastmoneyJywgProfileConfig,
    session: EastmoneyJywgSession,
  ): Promise<EastmoneyJywgSession> {
    const refreshed = await this.getValidateKey(profile, session);
    return touchSession(refreshed.session);
  }

  async getRawBrokerData(
    profile: EastmoneyJywgProfileConfig,
    session: EastmoneyJywgSession,
    options: EastmoneyJywgClientOptions = {},
  ): Promise<EastmoneyJywgRawBrokerData> {
    const validate = await this.getValidateKey(profile, session);
    let updatedSession = validate.session;
    const assetResult = await this.requestJson(profile, updatedSession, "query_asset_and_position", validate.validateKey);
    updatedSession = assetResult.session;
    const positionResult = await this.requestJson(profile, updatedSession, "query_positions", validate.validateKey);
    updatedSession = positionResult.session;

    let orders: unknown | undefined;
    let deals: unknown | undefined;
    if (options.includeOrders) {
      const result = await this.requestJson(profile, updatedSession, "query_orders", validate.validateKey);
      orders = result.payload;
      updatedSession = result.session;
    }
    if (options.includeDeals) {
      const result = await this.requestJson(profile, updatedSession, "query_deals", validate.validateKey);
      deals = result.payload;
      updatedSession = result.session;
    }

    return {
      captured_at: new Date().toISOString(),
      asset_and_position: assetResult.payload,
      positions: positionResult.payload,
      orders,
      deals,
      updated_session: touchSession(updatedSession),
      warnings: [],
    };
  }

  private async getValidateKey(
    profile: EastmoneyJywgProfileConfig,
    session: EastmoneyJywgSession,
  ): Promise<{ validateKey: string; session: EastmoneyJywgSession }> {
    const url = buildEndpointUrl(profile, "trade_buy");
    const res = await this.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        Cookie: buildCookieHeader(session.cookies),
        Referer: `${profile.base_url}/`,
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    assertSafeRedirect(res.headers.get("location"), profile.base_url);
    const sessionWithCookies = mergeSessionCookies(session, cookiesFromResponse(res.headers));
    if (res.status >= 300 && res.status < 400) {
      throw new EastmoneyJywgLoginChallengeError("eastmoney-jywg redirected to login or challenge page");
    }
    if (!res.ok) throw new Error(`eastmoney-jywg Trade/Buy HTTP ${res.status}`);
    const html = await res.text();
    ensureNotLoginPage(html, "Trade/Buy");
    return { validateKey: extractValidateKey(html), session: sessionWithCookies };
  }

  private async requestJson(
    profile: EastmoneyJywgProfileConfig,
    session: EastmoneyJywgSession,
    endpointName: EastmoneyJywgEndpointName,
    validateKey: string,
  ): Promise<{ payload: unknown; session: EastmoneyJywgSession }> {
    const url = buildEndpointUrl(profile, endpointName, validateKey);
    const body = new URLSearchParams(DEFAULT_FORM);
    const res = await this.fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: buildCookieHeader(session.cookies),
        Referer: `${profile.base_url}/Trade/Buy`,
        Origin: profile.base_url,
        Host: "jywg.18.cn",
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body,
    });
    assertSafeRedirect(res.headers.get("location"), profile.base_url);
    const updatedSession = mergeSessionCookies(session, cookiesFromResponse(res.headers));
    if (res.status >= 300 && res.status < 400) {
      throw new EastmoneyJywgLoginChallengeError(`${endpointName}: eastmoney-jywg redirected to login or challenge page`);
    }
    if (!res.ok) throw new Error(`${endpointName}: HTTP ${res.status}`);
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      ensureNotLoginPage(text, endpointName);
      throw new Error(`${endpointName}: eastmoney-jywg returned non-JSON response`);
    }
    assertJywgJson(payload, endpointName);
    return { payload, session: updatedSession };
  }
}

export const __testables = {
  extractValidateKey,
  cookiesFromResponse,
  splitSetCookieHeader,
  assertJywgJson,
};

import { buildEndpointUrl, sanitizeError } from "./safety.js";
import { buildCookieHeader, touchSession } from "./session-vault.js";
import type {
  EastmoneyMyfavorGroup,
  EastmoneyMyfavorProfileConfig,
  EastmoneyMyfavorSecurity,
  EastmoneyMyfavorSession,
} from "./types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function callbackName(): string {
  return `jQuery${Date.now()}`;
}

function requestParams(profile: EastmoneyMyfavorProfileConfig, extra: Record<string, string> = {}): Record<string, string> {
  if (!profile.appkey.trim()) throw new Error("eastmoney-myfavor appkey is required; set it in config.yaml or MINICLAW_EASTMONEY_MYFAVOR_APPKEY");
  const now = String(Date.now());
  return {
    appkey: profile.appkey,
    cb: callbackName(),
    _: now,
    ...extra,
  };
}

function parseJsonp(text: string): unknown {
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) {
    if (/登录|login|passport|验证码|安全/i.test(text)) throw new Error("eastmoney-myfavor returned a login challenge");
    throw new Error("eastmoney-myfavor returned non-JSONP response");
  }
  return JSON.parse(text.slice(start + 1, end)) as unknown;
}

function assertState(payload: unknown, context: string): Record<string, unknown> {
  if (!isRecord(payload)) throw new Error(`${context}: eastmoney-myfavor returned invalid payload`);
  const state = payload.state;
  if (state !== true && state !== 1 && state !== "true" && state !== "1") {
    throw new Error(`${context}: eastmoney-myfavor returned state=${String(state)}${payload.message ? ` message=${String(payload.message)}` : ""}`);
  }
  return payload;
}

function groupRows(payload: Record<string, unknown>): EastmoneyMyfavorGroup[] {
  const data = isRecord(payload.data) ? payload.data : {};
  const rows = Array.isArray(data.ginfolist) ? data.ginfolist : [];
  return rows.filter(isRecord).map((row): EastmoneyMyfavorGroup | undefined => {
    const gid = str(row.gid) ?? (typeof row.gid === "number" ? String(row.gid) : undefined);
    const gname = str(row.gname) ?? str(row.name);
    return gid && gname ? { gid, gname } : undefined;
  }).filter((item): item is EastmoneyMyfavorGroup => item !== undefined);
}

function securityCode(security: string): { marketFlag?: string; code: string } {
  const parts = security.split("$");
  if (parts.length >= 2) return { marketFlag: parts[0], code: parts.slice(1).join("$") };
  return { code: security };
}

function securityRows(
  payload: Record<string, unknown>,
  group: EastmoneyMyfavorGroup,
): EastmoneyMyfavorSecurity[] {
  const data = isRecord(payload.data) ? payload.data : {};
  const rows = Array.isArray(data.stkinfolist) ? data.stkinfolist : [];
  return rows.filter(isRecord).map((row): EastmoneyMyfavorSecurity | undefined => {
    const security = str(row.security);
    if (!security) return undefined;
    const parsed = securityCode(security);
    return {
      group_id: group.gid,
      group_name: group.gname,
      security,
      code: parsed.code,
      name: str(row.sname) ?? str(row.name) ?? str(row.stockname),
      market_flag: parsed.marketFlag,
    };
  }).filter((item): item is EastmoneyMyfavorSecurity => item !== undefined);
}

export class HttpEastmoneyMyfavorClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async getGroups(
    profile: EastmoneyMyfavorProfileConfig,
    session: EastmoneyMyfavorSession,
  ): Promise<{ groups: EastmoneyMyfavorGroup[]; session: EastmoneyMyfavorSession }> {
    const payload = await this.request(profile, session, "groups", { g: "1" });
    return { groups: groupRows(payload), session: touchSession(session) };
  }

  async getSecurities(
    profile: EastmoneyMyfavorProfileConfig,
    session: EastmoneyMyfavorSession,
    options: { groups?: string[]; limit?: number } = {},
  ): Promise<{ securities: EastmoneyMyfavorSecurity[]; session: EastmoneyMyfavorSession }> {
    const groupResult = await this.getGroups(profile, session);
    const selectedGroups = options.groups?.length
      ? groupResult.groups.filter((group) => options.groups?.includes(group.gname) || options.groups?.includes(group.gid))
      : groupResult.groups;
    const securities: EastmoneyMyfavorSecurity[] = [];
    for (const group of selectedGroups) {
      const payload = await this.request(profile, groupResult.session, "securities", { g: group.gid });
      securities.push(...securityRows(payload, group));
      if (options.limit && securities.length >= options.limit) break;
    }
    return {
      securities: securities.slice(0, options.limit ?? securities.length),
      session: touchSession(groupResult.session),
    };
  }

  private async request(
    profile: EastmoneyMyfavorProfileConfig,
    session: EastmoneyMyfavorSession,
    endpointName: "groups" | "securities",
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = buildEndpointUrl(profile, endpointName, requestParams(profile, params));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), profile.timeout_ms);
    try {
      const res = await this.fetchImpl(url, {
        signal: ac.signal,
        headers: {
          Cookie: buildCookieHeader(session.cookies),
          Referer: "https://quote.eastmoney.com/zixuan/",
          "User-Agent": USER_AGENT,
          Accept: "application/javascript, */*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`${endpointName}: HTTP ${res.status}`);
      return assertState(parseJsonp(await res.text()), endpointName);
    } catch (err) {
      throw new Error(sanitizeError(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

export const __testables = { parseJsonp, groupRows, securityRows, securityCode };

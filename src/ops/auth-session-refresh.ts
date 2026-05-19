import {
  HttpEastmoneyJywgClient,
} from "../mcp/eastmoney-jywg/client.js";
import { loadEastmoneyJywgConfig, resolveEastmoneyJywgProfile } from "../mcp/eastmoney-jywg/config.js";
import {
  EastmoneyJywgInvalidSessionError,
  EastmoneyJywgLoginChallengeError,
} from "../mcp/eastmoney-jywg/errors.js";
import {
  loadEastmoneyJywgSession,
  saveEastmoneyJywgSession,
} from "../mcp/eastmoney-jywg/session-vault.js";
import { sanitizeError as sanitizeEastmoneyError } from "../mcp/eastmoney-jywg/safety.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgProfileConfig,
  EastmoneyJywgSession,
} from "../mcp/eastmoney-jywg/types.js";
import { saveWechatMpSession } from "../providers/wechat-mp/auth.js";
import { refreshWechatMpBrowserSession } from "../providers/wechat-mp/browser-refresh.js";
import { loadWechatMpProviderConfig } from "../providers/wechat-mp/config.js";
import { sanitizeWechatMpError, WechatMpInvalidSessionError } from "../providers/wechat-mp/errors.js";
import type { WechatMpProviderConfig, WechatMpSession } from "../providers/wechat-mp/types.js";

export type AuthSessionRefreshProvider = "wechat-mp" | "eastmoney-jywg";
export type AuthSessionRefreshStatus = "refreshed" | "manual_required" | "error";

export interface AuthSessionRefreshResult {
  provider: AuthSessionRefreshProvider;
  profile: string;
  status: AuthSessionRefreshStatus;
  checked_at: string;
  detail: string;
  action?: string;
  category?: "auth" | "config" | "network" | "unknown";
  cookie_count?: number;
  last_verified_at?: string;
  expires_at_hint?: string;
  safe_details?: Record<string, unknown>;
}

export interface AuthSessionRefreshOptions {
  providers?: readonly AuthSessionRefreshProvider[];
  wechatConfigNames?: readonly string[];
  eastmoneyProfiles?: readonly string[];
  headless?: boolean;
  timeoutMs?: number;
  checkQuery?: string;
  now?: () => Date;
}

export interface AuthSessionRefreshDeps {
  loadWechatConfig?: (name?: string) => WechatMpProviderConfig;
  refreshWechatBrowserSession?: (
    config: WechatMpProviderConfig,
    options: { headless: boolean; timeoutMs?: number; checkQuery?: string; now?: () => Date },
  ) => Promise<WechatMpSession>;
  saveWechatSession?: typeof saveWechatMpSession;
  loadEastmoneyConfig?: () => EastmoneyJywgConfig;
  eastmoneyClient?: EastmoneyJywgClient;
  loadEastmoneySession?: typeof loadEastmoneyJywgSession;
  saveEastmoneySession?: typeof saveEastmoneyJywgSession;
}

const DEFAULT_WECHAT_CONFIG_NAMES = ["daily-ai-wechat"] as const;

function checkedAt(options: AuthSessionRefreshOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function isEastmoneyManualRequired(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return err instanceof EastmoneyJywgInvalidSessionError
    || err instanceof EastmoneyJywgLoginChallengeError
    || /login challenge|session expired|invalid session|重新登录|登录|验证码|短信|安全控件/i.test(message);
}

function isWechatManualRequired(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return err instanceof WechatMpInvalidSessionError
    || /invalid session|visible re-authentication|scan|confirm login|token/i.test(message);
}

function result(
  provider: AuthSessionRefreshProvider,
  profile: string,
  status: AuthSessionRefreshStatus,
  checked_at: string,
  detail: string,
  extra: Partial<AuthSessionRefreshResult> = {},
): AuthSessionRefreshResult {
  return { provider, profile, status, checked_at, detail, ...extra };
}

async function refreshEastmoneyProfile(
  profileName: string,
  profile: EastmoneyJywgProfileConfig,
  checked_at: string,
  deps: Required<Pick<
    AuthSessionRefreshDeps,
    "eastmoneyClient" | "loadEastmoneySession" | "saveEastmoneySession"
  >>,
): Promise<AuthSessionRefreshResult> {
  let session: EastmoneyJywgSession;
  try {
    session = deps.loadEastmoneySession(profile.session_secret_path);
  } catch (err) {
    return result("eastmoney-jywg", profileName, "manual_required", checked_at, sanitizeEastmoneyError(err), {
      category: "auth",
      action: `pnpm eastmoney-jywg:login -- --profile ${profileName}`,
    });
  }

  try {
    const refreshed = deps.eastmoneyClient.refreshSession
      ? await deps.eastmoneyClient.refreshSession(profile, session)
      : (await deps.eastmoneyClient.getRawBrokerData(profile, session, {
          includeOrders: false,
          includeDeals: false,
        })).updated_session;
    deps.saveEastmoneySession(profile.session_secret_path, refreshed);
    return result("eastmoney-jywg", profileName, "refreshed", checked_at, "Eastmoney JYWG readonly session refreshed", {
      category: "auth",
      cookie_count: refreshed.cookies.length,
      last_verified_at: refreshed.last_verified_at,
      expires_at_hint: refreshed.expires_at_hint,
      safe_details: {
        host: profile.base_url.replace("https://", ""),
        session_secret_path_configured: Boolean(profile.session_secret_path),
      },
    });
  } catch (err) {
    return result("eastmoney-jywg", profileName, isEastmoneyManualRequired(err) ? "manual_required" : "error", checked_at, sanitizeEastmoneyError(err), {
      category: isEastmoneyManualRequired(err) ? "auth" : "unknown",
      cookie_count: session.cookies.length,
      last_verified_at: session.last_verified_at,
      expires_at_hint: session.expires_at_hint,
      action: `pnpm eastmoney-jywg:login -- --profile ${profileName}`,
    });
  }
}

export async function runEastmoneyJywgSessionRefresh(
  profileNames?: readonly string[],
  options: AuthSessionRefreshOptions = {},
  deps: AuthSessionRefreshDeps = {},
): Promise<AuthSessionRefreshResult[]> {
  const at = checkedAt(options);
  const loadConfig = deps.loadEastmoneyConfig ?? loadEastmoneyJywgConfig;
  let config: EastmoneyJywgConfig;
  try {
    config = loadConfig();
  } catch (err) {
    return [result("eastmoney-jywg", "config", "error", at, sanitizeEastmoneyError(err), { category: "config" })];
  }

  const names = profileNames?.length ? profileNames : Object.keys(config.profiles).sort();
  return await Promise.all(names.map(async (name) => {
    try {
      const profile = resolveEastmoneyJywgProfile(config, name);
      return await refreshEastmoneyProfile(name, profile, at, {
        eastmoneyClient: deps.eastmoneyClient ?? new HttpEastmoneyJywgClient(),
        loadEastmoneySession: deps.loadEastmoneySession ?? loadEastmoneyJywgSession,
        saveEastmoneySession: deps.saveEastmoneySession ?? saveEastmoneyJywgSession,
      });
    } catch (err) {
      return result("eastmoney-jywg", name, "error", at, sanitizeEastmoneyError(err), { category: "config" });
    }
  }));
}

export async function runWechatMpSessionRefresh(
  configName: string,
  options: AuthSessionRefreshOptions = {},
  deps: AuthSessionRefreshDeps = {},
): Promise<AuthSessionRefreshResult> {
  const at = checkedAt(options);
  const loadConfig = deps.loadWechatConfig ?? loadWechatMpProviderConfig;
  let config: WechatMpProviderConfig;
  try {
    config = loadConfig(configName);
  } catch (err) {
    return result("wechat-mp", configName, "error", at, sanitizeWechatMpError(err), { category: "config" });
  }

  try {
    const refresh = deps.refreshWechatBrowserSession ?? refreshWechatMpBrowserSession;
    const session = await refresh(config, {
      headless: options.headless ?? true,
      timeoutMs: options.timeoutMs,
      checkQuery: options.checkQuery,
      now: options.now,
    });
    (deps.saveWechatSession ?? saveWechatMpSession)(config.auth_path, session);
    return result("wechat-mp", configName, "refreshed", at, "WeChat MP browser profile session refreshed", {
      category: "auth",
      cookie_count: session.cookies.length,
      last_verified_at: session.saved_at,
      safe_details: {
        auth_path_configured: Boolean(config.auth_path),
        browser_profile_dir_configured: Boolean(config.browser_profile_dir),
      },
    });
  } catch (err) {
    const manual = isWechatManualRequired(err);
    return result("wechat-mp", configName, manual ? "manual_required" : "error", at, sanitizeWechatMpError(err), {
      category: manual ? "auth" : "unknown",
      action: `pnpm wechat-mp:refresh -- --config ${configName} --visible`,
      safe_details: {
        auth_path_configured: Boolean(config.auth_path),
        browser_profile_dir_configured: Boolean(config.browser_profile_dir),
      },
    });
  }
}

export async function runAuthSessionRefresh(
  options: AuthSessionRefreshOptions = {},
  deps: AuthSessionRefreshDeps = {},
): Promise<AuthSessionRefreshResult[]> {
  const providers = options.providers ?? ["eastmoney-jywg", "wechat-mp"];
  const groups: AuthSessionRefreshResult[][] = [];
  if (providers.includes("eastmoney-jywg")) {
    groups.push(await runEastmoneyJywgSessionRefresh(options.eastmoneyProfiles, options, deps));
  }
  if (providers.includes("wechat-mp")) {
    const names = options.wechatConfigNames?.length ? options.wechatConfigNames : DEFAULT_WECHAT_CONFIG_NAMES;
    groups.push(await Promise.all(names.map((name) => runWechatMpSessionRefresh(name, options, deps))));
  }
  return groups.flat();
}

export function formatAuthSessionRefreshResults(results: readonly AuthSessionRefreshResult[]): string {
  if (!results.length) return "No auth sessions were selected for refresh.";
  return results.map((item) => {
    const target = `${item.provider}/${item.profile}`;
    const parts = [
      `[${item.status}] ${target}`,
      item.detail,
      item.cookie_count !== undefined ? `cookies=${item.cookie_count}` : undefined,
      item.last_verified_at ? `last_verified_at=${item.last_verified_at}` : undefined,
      item.action ? `action=${item.action}` : undefined,
    ].filter(Boolean);
    return parts.join(" | ");
  }).join("\n");
}

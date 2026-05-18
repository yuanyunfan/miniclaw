import { searchEmailMessages } from "../capabilities/email/query.js";
import type { EmailSearchResult } from "../capabilities/email/types.js";
import { HttpEastmoneyJywgClient } from "../mcp/eastmoney-jywg/client.js";
import { loadEastmoneyJywgConfig } from "../mcp/eastmoney-jywg/config.js";
import { mapEastmoneyJywgRawBrokerData } from "../mcp/eastmoney-jywg/mapper.js";
import {
  loadEastmoneyJywgSession,
  saveEastmoneyJywgSession,
} from "../mcp/eastmoney-jywg/session-vault.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgRawBrokerData,
  EastmoneyJywgSession,
} from "../mcp/eastmoney-jywg/types.js";
import { loadFutuStockConfig } from "../mcp/futu-stock/config.js";
import { PythonFutuStockClient } from "../mcp/futu-stock/futu-client.js";
import { mapFutuRawBrokerData } from "../mcp/futu-stock/mapper.js";
import type { FutuRawBrokerData, FutuStockClient, FutuStockConfig } from "../mcp/futu-stock/types.js";
import { loadCmbCreditCardEmailConfig } from "../providers/cmb-credit-card-email/config.js";
import type { CmbCreditCardEmailConfig } from "../providers/cmb-credit-card-email/types.js";
import { loadEmailQueryProviderConfig, type EmailQueryProviderConfig } from "../providers/email-query/config.js";
import { loadMarketIntelProviderConfig } from "../providers/market-intel/config.js";
import { categorizeProviderError, type ProviderHealthResult } from "../providers/framework.js";
import { runProviderHealthCheck as defaultRunProviderHealthCheck } from "../providers/index.js";
import { loadStockPortfolioProviderConfig } from "../providers/stock-portfolio/config.js";
import { loadStockPulseProviderConfig } from "../providers/stock-pulse/config.js";
import { loadWechatMpSession } from "../providers/wechat-mp/auth.js";
import { HttpWechatMpClient } from "../providers/wechat-mp/client.js";
import { loadWechatMpProviderConfig } from "../providers/wechat-mp/config.js";
import { sanitizeWechatMpError } from "../providers/wechat-mp/errors.js";
import type { WechatMpClient, WechatMpProviderConfig, WechatMpSession } from "../providers/wechat-mp/types.js";
import type { PreProviderRunArgs } from "../providers/types.js";
import type { MarketIntelProviderConfig } from "../stock/data/market-intel-types.js";
import type { StockPortfolioProviderConfig } from "../stock/data/portfolio-types.js";
import type { StockPulseProviderConfig } from "../stock/data/pulse-types.js";
import { FetchMarketIntelOfficialHttpClient } from "../stock/sources/official/collectors/official-http.js";
import type { MarketIntelOfficialHttpClient } from "../stock/sources/official/collectors/official-shared.js";
import { fetchYahooChartSeries } from "../stock/sources/yahoo/index.js";

export type ThirdPartyHealthProvider = string;
export type ThirdPartyHealthStatus = "ok" | "error" | "skipped";
export type ThirdPartyHealthStage =
  | "config"
  | "session"
  | "health"
  | "query"
  | "network"
  | "schema"
  | "aggregate";
export type ThirdPartyHealthKind =
  | "broker"
  | "provider"
  | "web"
  | "email"
  | "content"
  | "official"
  | "aggregate";

export interface ThirdPartyHealthCheck {
  provider: ThirdPartyHealthProvider;
  profile: string;
  status: ThirdPartyHealthStatus;
  stage: ThirdPartyHealthStage;
  detail: string;
  checked_at: string;
  kind?: ThirdPartyHealthKind;
  category?: string;
  latency_ms?: number;
  safe_details?: Record<string, unknown>;
  positions_count?: number;
  host?: string;
  port?: number;
  cookie_count?: number;
  last_verified_at?: string;
  captured_at?: string;
}

export interface ThirdPartyHealthReport {
  checked_at: string;
  ok: boolean;
  checks: ThirdPartyHealthCheck[];
}

export interface ProviderHealthTarget {
  provider: string;
  configName?: string;
}

export interface EmailHealthTarget {
  provider: "cmb-credit-card-email" | "email-query";
  configName?: string;
}

type EmailSearcher = typeof searchEmailMessages;
type YahooChartFetcher = typeof fetchYahooChartSeries;

export interface ThirdPartyHealthDeps {
  loadFutuConfig?: () => FutuStockConfig;
  futuClient?: FutuStockClient;
  loadEastmoneyConfig?: () => EastmoneyJywgConfig;
  eastmoneyClient?: EastmoneyJywgClient;
  loadEastmoneySession?: typeof loadEastmoneyJywgSession;
  saveEastmoneySession?: typeof saveEastmoneyJywgSession;
  runProviderHealthCheck?: (name: string, args: PreProviderRunArgs) => Promise<ProviderHealthResult>;
  providerHealthTargets?: readonly ProviderHealthTarget[];
  loadStockPulseConfig?: (name?: string) => StockPulseProviderConfig;
  yahooConfigNames?: readonly string[];
  fetchYahooChartSeries?: YahooChartFetcher;
  loadWechatConfig?: (name?: string) => WechatMpProviderConfig;
  loadWechatSession?: typeof loadWechatMpSession;
  createWechatClient?: (session: WechatMpSession) => WechatMpClient;
  wechatConfigNames?: readonly string[];
  loadCmbCreditCardEmailConfig?: typeof loadCmbCreditCardEmailConfig;
  loadEmailQueryConfig?: typeof loadEmailQueryProviderConfig;
  searchEmailMessages?: EmailSearcher;
  emailHealthTargets?: readonly EmailHealthTarget[];
  loadMarketIntelConfig?: (name?: string) => MarketIntelProviderConfig;
  marketIntelConfigNames?: readonly string[];
  officialHttp?: MarketIntelOfficialHttpClient;
  loadStockPortfolioConfig?: (name?: string) => StockPortfolioProviderConfig;
  stockPortfolioConfigNames?: readonly string[];
  includeExtendedChecks?: boolean;
  now?: () => Date;
}

const DEFAULT_PROVIDER_HEALTH_TARGETS: readonly ProviderHealthTarget[] = [
  { provider: "eastmoney-etf-premium", configName: "cn-stock" },
  { provider: "eastmoney-jywg-readonly", configName: "cn-stock" },
  { provider: "eastmoney-jywg-readonly", configName: "daily-stock-market" },
  { provider: "eastmoney-jywg-readonly", configName: "daily-stock-summary" },
  { provider: "stock-pulse", configName: "cn-hourly" },
  { provider: "stock-pulse", configName: "us-hourly" },
  { provider: "stock-watchlist-research", configName: "cn-daily" },
  { provider: "stock-watchlist-research", configName: "cn-pre-market" },
  { provider: "stock-watchlist-research", configName: "us-daily" },
  { provider: "stock-watchlist-research", configName: "us-pre-market" },
];

const DEFAULT_YAHOO_CONFIG_NAMES = ["cn-hourly", "us-hourly"] as const;
const DEFAULT_WECHAT_CONFIG_NAMES = ["daily-ai-wechat"] as const;
const DEFAULT_EMAIL_HEALTH_TARGETS: readonly EmailHealthTarget[] = [
  { provider: "cmb-credit-card-email", configName: "default" },
  { provider: "email-query", configName: "default" },
];
const DEFAULT_MARKET_INTEL_CONFIG_NAMES = ["us-pre-market", "cn-pre-market"] as const;
const DEFAULT_STOCK_PORTFOLIO_CONFIG_NAMES = [
  "cn-stock",
  "us-stock",
  "daily-stock-summary",
  "daily-stock-market",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function redactSensitiveText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted-email>")
    .replace(/(cookie|validate[_-]?key|token|password|secret|session|acc[_-]?id|account|authorization)\s*[:=]\s*[^,\s;}]+/gi, "$1=<redacted>")
    .replace(/(Cookie:\s*)[^\n\r]+/gi, "$1<redacted>")
    .replace(/([?&]validatekey=)[^&\s]+/gi, "$1<redacted>")
    .replace(/\b[A-Za-z0-9_./+=-]{32,}\b/g, "<redacted>")
    .slice(0, 500);
}

function okCheck(
  provider: ThirdPartyHealthProvider,
  profile: string,
  checkedAt: string,
  stage: ThirdPartyHealthStage,
  detail: string,
  extra: Partial<ThirdPartyHealthCheck> = {},
): ThirdPartyHealthCheck {
  return {
    provider,
    profile,
    status: "ok",
    stage,
    detail,
    checked_at: checkedAt,
    ...extra,
  };
}

function errorCheck(
  provider: ThirdPartyHealthProvider,
  profile: string,
  checkedAt: string,
  stage: ThirdPartyHealthStage,
  detail: unknown,
  extra: Partial<ThirdPartyHealthCheck> = {},
): ThirdPartyHealthCheck {
  const message = redactSensitiveText(detail);
  return {
    provider,
    profile,
    status: "error",
    stage,
    detail: message,
    checked_at: checkedAt,
    category: extra.category ?? categorizeProviderError(new Error(message)),
    ...extra,
  };
}

async function measuredCheck(
  provider: ThirdPartyHealthProvider,
  profile: string,
  checkedAt: string,
  stage: ThirdPartyHealthStage,
  detail: string,
  fn: () => Promise<Partial<ThirdPartyHealthCheck> | void>,
  extra: Partial<ThirdPartyHealthCheck> = {},
): Promise<ThirdPartyHealthCheck> {
  const started = Date.now();
  try {
    const result = await fn();
    return okCheck(provider, profile, checkedAt, stage, detail, {
      ...extra,
      ...result,
      latency_ms: Date.now() - started,
    });
  } catch (err) {
    return errorCheck(provider, profile, checkedAt, stage, err, {
      ...extra,
      latency_ms: Date.now() - started,
    });
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function yyyymmdd(date: Date): string {
  return dateOnly(date).replace(/-/g, "");
}

async function checkFutuProfiles(
  checkedAt: string,
  deps: Required<Pick<ThirdPartyHealthDeps, "loadFutuConfig" | "futuClient">>,
): Promise<ThirdPartyHealthCheck[]> {
  let config: FutuStockConfig;
  try {
    config = deps.loadFutuConfig();
  } catch (err) {
    return [errorCheck("futu-stock", "config", checkedAt, "config", err, { kind: "broker" })];
  }

  const checks: ThirdPartyHealthCheck[] = [];
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const common = {
      kind: "broker" as const,
      host: profile.opend_host,
      port: profile.opend_port,
    };
    try {
      const health = await deps.futuClient.healthCheck(profile);
      if (!health.ok) {
        const detail = health.opend.error ?? health.python.error ?? "Futu OpenD or Python SDK health check failed";
        checks.push(errorCheck("futu-stock", profileName, checkedAt, "health", detail, common));
        continue;
      }
    } catch (err) {
      checks.push(errorCheck("futu-stock", profileName, checkedAt, "health", err, common));
      continue;
    }

    try {
      const raw = await deps.futuClient.getRawBrokerData(profile);
      const snapshot = mapFutuRawBrokerData(raw as FutuRawBrokerData, profile, "third_party_health_check");
      checks.push(okCheck("futu-stock", profileName, checkedAt, "query", "Futu OpenD and read-only broker query succeeded", {
        ...common,
        positions_count: snapshot.positions.length,
        captured_at: snapshot.captured_at,
      }));
    } catch (err) {
      checks.push(errorCheck("futu-stock", profileName, checkedAt, "query", err, common));
    }
  }
  return checks;
}

async function checkEastmoneyProfiles(
  checkedAt: string,
  deps: Required<Pick<
    ThirdPartyHealthDeps,
    "loadEastmoneyConfig" | "eastmoneyClient" | "loadEastmoneySession" | "saveEastmoneySession"
  >>,
): Promise<ThirdPartyHealthCheck[]> {
  let config: EastmoneyJywgConfig;
  try {
    config = deps.loadEastmoneyConfig();
  } catch (err) {
    return [errorCheck("eastmoney-jywg", "config", checkedAt, "config", err, { kind: "broker" })];
  }

  const checks: ThirdPartyHealthCheck[] = [];
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const common = {
      kind: "broker" as const,
      host: new URL(profile.base_url).hostname,
    };
    let session: EastmoneyJywgSession;
    try {
      session = deps.loadEastmoneySession(profile.session_secret_path);
    } catch (err) {
      checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "session", err, common));
      continue;
    }

    const sessionMeta = {
      ...common,
      cookie_count: session.cookies.length,
      last_verified_at: session.last_verified_at,
    };

    try {
      const health = await deps.eastmoneyClient.healthCheck(profile, session);
      if (!health.ok) {
        checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "health", health.session.error ?? "Eastmoney JYWG health check failed", sessionMeta));
        continue;
      }
    } catch (err) {
      checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "health", err, sessionMeta));
      continue;
    }

    try {
      const raw = await deps.eastmoneyClient.getRawBrokerData(profile, session, {
        includeOrders: false,
        includeDeals: false,
      });
      const snapshot = mapEastmoneyJywgRawBrokerData(raw as EastmoneyJywgRawBrokerData, profile, "third_party_health_check");
      deps.saveEastmoneySession(profile.session_secret_path, raw.updated_session);
      checks.push(okCheck("eastmoney-jywg", profileName, checkedAt, "query", "Eastmoney JYWG session and read-only broker query succeeded", {
        ...sessionMeta,
        positions_count: snapshot.positions.length,
        captured_at: snapshot.captured_at,
      }));
    } catch (err) {
      checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "query", err, sessionMeta));
    }
  }
  return checks;
}

async function checkProviderHealthTargets(
  checkedAt: string,
  deps: ThirdPartyHealthDeps,
): Promise<ThirdPartyHealthCheck[]> {
  const targets = deps.providerHealthTargets ?? DEFAULT_PROVIDER_HEALTH_TARGETS;
  const runProviderHealthCheck = deps.runProviderHealthCheck ?? defaultRunProviderHealthCheck;
  const runAt = new Date(checkedAt);
  return await Promise.all(targets.map(async (target) => {
    const profile = target.configName ?? "default";
    const started = Date.now();
    try {
      const result = await runProviderHealthCheck(target.provider, {
        configName: target.configName,
        jobName: `third-party-health:${target.provider}`,
        channelId: "third-party-health-check",
        runAt,
      });
      const extra = {
        kind: "provider" as const,
        latency_ms: Date.now() - started,
        category: result.category,
        safe_details: result.safeDetails,
      };
      if (!result.ok) {
        return errorCheck(target.provider, profile, checkedAt, "health", result.message, extra);
      }
      return okCheck(target.provider, profile, checkedAt, "health", result.message, extra);
    } catch (err) {
      return errorCheck(target.provider, profile, checkedAt, "health", err, {
        kind: "provider",
        latency_ms: Date.now() - started,
      });
    }
  }));
}

function yahooCanarySymbols(config: StockPulseProviderConfig): string[] {
  return [...new Set(config.universe.symbols
    .map((symbol) => symbol.yahoo_symbol ?? symbol.symbol)
    .filter((symbol) => typeof symbol === "string" && symbol.trim()))]
    .slice(0, 4);
}

async function checkYahooCanaries(
  checkedAt: string,
  deps: ThirdPartyHealthDeps,
): Promise<ThirdPartyHealthCheck[]> {
  const configNames = deps.yahooConfigNames ?? DEFAULT_YAHOO_CONFIG_NAMES;
  const loadConfig = deps.loadStockPulseConfig ?? loadStockPulseProviderConfig;
  const fetchSeries = deps.fetchYahooChartSeries ?? fetchYahooChartSeries;
  return await Promise.all(configNames.map(async (configName) => {
    let config: StockPulseProviderConfig;
    try {
      config = loadConfig(configName);
    } catch (err) {
      return errorCheck("yahoo", `stock-pulse/${configName}`, checkedAt, "config", err, { kind: "web" });
    }
    const symbols = yahooCanarySymbols(config);
    return await measuredCheck("yahoo", `stock-pulse/${configName}`, checkedAt, "query", "Yahoo chart canary succeeded", async () => {
      if (!symbols.length) throw new Error(`stock-pulse ${configName} has no Yahoo canary symbols`);
      const series = await Promise.all(symbols.map((symbol) => fetchSeries({
        providerSymbol: symbol,
        range: config.quote.range,
        interval: config.quote.interval,
        includePrePost: config.quote.include_prepost,
        timeoutMs: config.quote.timeout_ms,
        userAgent: "MiniClaw/third-party-health",
      })));
      return {
        safe_details: {
          config: configName,
          symbols,
          bar_counts: Object.fromEntries(series.map((item) => [item.provider_symbol, item.bars.length])),
          latest_at: Object.fromEntries(series.map((item) => [item.provider_symbol, item.latest_at])),
        },
      };
    }, { kind: "web", host: "query1.finance.yahoo.com" });
  }));
}

async function checkWechatProfiles(
  checkedAt: string,
  deps: ThirdPartyHealthDeps,
): Promise<ThirdPartyHealthCheck[]> {
  const configNames = deps.wechatConfigNames ?? DEFAULT_WECHAT_CONFIG_NAMES;
  const loadConfig = deps.loadWechatConfig ?? loadWechatMpProviderConfig;
  const loadSession = deps.loadWechatSession ?? loadWechatMpSession;
  const createClient = deps.createWechatClient ?? ((session: WechatMpSession) => new HttpWechatMpClient(session));
  return await Promise.all(configNames.map(async (configName) => {
    let config: WechatMpProviderConfig;
    try {
      config = loadConfig(configName);
    } catch (err) {
      return errorCheck("wechat-mp", configName, checkedAt, "config", err, { kind: "content" });
    }
    let session: WechatMpSession;
    try {
      session = loadSession(config.auth_path);
    } catch (err) {
      return errorCheck("wechat-mp", configName, checkedAt, "session", sanitizeWechatMpError(err), { kind: "content" });
    }
    const query = config.accounts[0]?.query ?? "阿里云开发者";
    return await measuredCheck("wechat-mp", configName, checkedAt, "query", "WeChat MP session and searchbiz query succeeded", async () => {
      const client = createClient(session);
      let results;
      try {
        results = await client.searchBiz(query);
      } catch (err) {
        throw new Error(sanitizeWechatMpError(err));
      }
      return {
        cookie_count: session.cookies.length,
        safe_details: {
          query,
          result_count: results.length,
          account_count: config.accounts.length,
        },
      };
    }, { kind: "content", host: "mp.weixin.qq.com" });
  }));
}

function emailWindow(now: Date, hours: number): { start: string; end: string } {
  return {
    start: new Date(now.getTime() - hours * 3_600_000).toISOString(),
    end: now.toISOString(),
  };
}

function emailSearchDetails(result: EmailSearchResult): Record<string, unknown> {
  return {
    profile: result.profile,
    message_count: result.messages.length,
    warning_count: result.warnings.length,
    folders: result.query.folders,
  };
}

async function checkEmailTargets(
  checkedAt: string,
  deps: ThirdPartyHealthDeps,
): Promise<ThirdPartyHealthCheck[]> {
  const targets = deps.emailHealthTargets ?? DEFAULT_EMAIL_HEALTH_TARGETS;
  const searcher = deps.searchEmailMessages ?? searchEmailMessages;
  const now = new Date(checkedAt);
  return await Promise.all(targets.map(async (target) => {
    const profile = target.configName ?? "default";
    if (target.provider === "cmb-credit-card-email") {
      const loadConfig = deps.loadCmbCreditCardEmailConfig ?? loadCmbCreditCardEmailConfig;
      let config: CmbCreditCardEmailConfig;
      try {
        config = loadConfig(profile);
      } catch (err) {
        return errorCheck(target.provider, profile, checkedAt, "config", err, { kind: "email" });
      }
      return await measuredCheck(target.provider, profile, checkedAt, "query", "CMB credit card email search canary succeeded", async () => {
        const window = emailWindow(now, Math.min(config.window_hours, 24));
        const result = await searcher({
          profile: config.email_profile,
          folders: config.folders,
          from: config.from,
          subject_includes: config.subject_includes,
          received_after: window.start,
          received_before: window.end,
          max_results: 1,
          include_body: false,
          include_attachments: false,
        });
        return { safe_details: emailSearchDetails(result) };
      }, { kind: "email" });
    }

    const loadConfig = deps.loadEmailQueryConfig ?? loadEmailQueryProviderConfig;
    let config: EmailQueryProviderConfig;
    try {
      config = loadConfig(profile);
    } catch (err) {
      return errorCheck(target.provider, profile, checkedAt, "config", err, { kind: "email" });
    }
    return await measuredCheck(target.provider, profile, checkedAt, "query", "Email query search canary succeeded", async () => {
      const window = emailWindow(now, Math.min(config.window_hours, 24));
      const result = await searcher({
        profile: config.email_profile,
        folders: config.folders,
        from: config.from,
        subject_includes: config.subject_includes,
        received_after: window.start,
        received_before: window.end,
        max_results: 1,
        include_body: false,
        include_attachments: false,
      });
      return { safe_details: emailSearchDetails(result) };
    }, { kind: "email" });
  }));
}

function assertNonEmptyText(text: string, label: string): void {
  if (!text.trim()) throw new Error(`${label} returned empty text`);
}

function assertRecordPayload(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} returned non-object payload`);
}

async function officialTextCheck(
  http: MarketIntelOfficialHttpClient,
  checkedAt: string,
  profile: string,
  endpoint: string,
  url: string,
  init: { headers?: Record<string, string> } = {},
): Promise<ThirdPartyHealthCheck> {
  return await measuredCheck("market-intel-official", `${profile}/${endpoint}`, checkedAt, "network", `${endpoint} official endpoint is reachable`, async () => {
    const text = await http.getText(url, init);
    assertNonEmptyText(text, endpoint);
    return {
      safe_details: { config: profile, endpoint, bytes: text.length },
    };
  }, { kind: "official", host: new URL(url).hostname });
}

async function officialJsonCheck(
  http: MarketIntelOfficialHttpClient,
  checkedAt: string,
  profile: string,
  endpoint: string,
  url: string,
  init: { headers?: Record<string, string> } = {},
): Promise<ThirdPartyHealthCheck> {
  return await measuredCheck("market-intel-official", `${profile}/${endpoint}`, checkedAt, "schema", `${endpoint} official JSON endpoint is reachable`, async () => {
    const json = await http.getJson(url, init);
    assertRecordPayload(json, endpoint);
    return {
      safe_details: { config: profile, endpoint },
    };
  }, { kind: "official", host: new URL(url).hostname });
}

async function officialPostJsonCheck(
  http: MarketIntelOfficialHttpClient,
  checkedAt: string,
  profile: string,
  endpoint: string,
  url: string,
  body: unknown,
  init: { headers?: Record<string, string> } = {},
): Promise<ThirdPartyHealthCheck> {
  return await measuredCheck("market-intel-official", `${profile}/${endpoint}`, checkedAt, "schema", `${endpoint} official POST endpoint is reachable`, async () => {
    const json = await http.postJson(url, body, init);
    assertRecordPayload(json, endpoint);
    return {
      safe_details: { config: profile, endpoint },
    };
  }, { kind: "official", host: new URL(url).hostname });
}

function buildOfficialSourceChecks(
  checkedAt: string,
  configName: string,
  config: MarketIntelProviderConfig,
  http: MarketIntelOfficialHttpClient,
): Array<Promise<ThirdPartyHealthCheck>> {
  const runAt = new Date(checkedAt);
  const checks: Array<Promise<ThirdPartyHealthCheck>> = [];
  if (config.market_scope === "us") {
    if (config.sources.macro.federal_reserve) {
      checks.push(officialTextCheck(http, checkedAt, configName, "fed-rss", "https://www.federalreserve.gov/feeds/press_all.xml"));
    }
    if (config.sources.macro.treasury) {
      const year = runAt.getUTCFullYear();
      checks.push(officialTextCheck(http, checkedAt, configName, "treasury-yield-xml", `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`));
    }
    if (config.sources.macro.bls) {
      const year = runAt.getUTCFullYear();
      checks.push(officialPostJsonCheck(http, checkedAt, configName, "bls-public-api", "https://api.bls.gov/publicAPI/v2/timeseries/data/", {
        seriesid: ["LNS14000000"],
        startyear: String(year),
        endyear: String(year),
      }));
    }
    if (config.sources.earnings.provider === "sec_edgar") {
      checks.push(officialJsonCheck(http, checkedAt, configName, "sec-company-tickers", "https://www.sec.gov/files/company_tickers_exchange.json", {
        headers: { "User-Agent": "MiniClaw/third-party-health yuan@example.invalid" },
      }));
    }
    return checks;
  }

  if (config.sources.macro.pboc) {
    checks.push(officialTextCheck(http, checkedAt, configName, "pboc-omo", "http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html"));
  }
  if (config.sources.macro.nbs) {
    checks.push(officialTextCheck(http, checkedAt, configName, "nbs-press-release", "https://www.stats.gov.cn/english/PressRelease/"));
  }
  if (config.sources.earnings.provider === "exchange_announcements") {
    const beginDate = dateOnly(addDays(runAt, -7));
    const endDate = dateOnly(runAt);
    const sse = new URL("https://query.sse.com.cn/security/stock/queryCompanyBulletin.do");
    sse.searchParams.set("jsonCallBack", "jsonpCallback");
    sse.searchParams.set("isPagination", "true");
    sse.searchParams.set("pageHelp.pageSize", "1");
    sse.searchParams.set("pageHelp.pageNo", "1");
    sse.searchParams.set("pageHelp.beginPage", "1");
    sse.searchParams.set("pageHelp.cacheSize", "1");
    sse.searchParams.set("securityType", "0101,120100,020100,020200,120200");
    sse.searchParams.set("reportType", "ALL");
    sse.searchParams.set("beginDate", beginDate);
    sse.searchParams.set("endDate", endDate);
    checks.push(officialTextCheck(http, checkedAt, configName, "sse-announcements", sse.href, {
      headers: { Referer: "https://www.sse.com.cn/" },
    }));
    checks.push(officialPostJsonCheck(http, checkedAt, configName, "szse-announcements", "https://www.szse.cn/api/disc/announcement/annList?random=0.1", {
      seDate: [beginDate, endDate],
      channelCode: ["listedNotice_disc"],
      pageSize: 1,
      pageNum: 1,
    }, {
      headers: { Referer: "https://www.szse.cn/disclosure/listed/notice/index.html" },
    }));
    const hkex = new URL("https://www1.hkexnews.hk/search/titlesearch.xhtml");
    hkex.searchParams.set("lang", "en");
    hkex.searchParams.set("market", "SEHK");
    hkex.searchParams.set("searchType", "0");
    hkex.searchParams.set("documentType", "-1");
    hkex.searchParams.set("sortByOptions", "DateTime");
    hkex.searchParams.set("sortDir", "0");
    hkex.searchParams.set("from", yyyymmdd(addDays(runAt, -7)));
    hkex.searchParams.set("to", yyyymmdd(runAt));
    hkex.searchParams.set("rowRange", "1");
    checks.push(officialTextCheck(http, checkedAt, configName, "hkex-announcements", hkex.href, {
      headers: { Referer: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en" },
    }));
  }
  return checks;
}

async function checkMarketIntelOfficialSources(
  checkedAt: string,
  deps: ThirdPartyHealthDeps,
): Promise<ThirdPartyHealthCheck[]> {
  const configNames = deps.marketIntelConfigNames ?? DEFAULT_MARKET_INTEL_CONFIG_NAMES;
  const loadConfig = deps.loadMarketIntelConfig ?? loadMarketIntelProviderConfig;
  const http = deps.officialHttp ?? new FetchMarketIntelOfficialHttpClient();
  const checks: Array<Promise<ThirdPartyHealthCheck>> = [];

  for (const configName of configNames) {
    let config: MarketIntelProviderConfig;
    try {
      config = loadConfig(configName);
    } catch (err) {
      checks.push(Promise.resolve(errorCheck("market-intel-official", configName, checkedAt, "config", err, { kind: "official" })));
      continue;
    }
    checks.push(...buildOfficialSourceChecks(checkedAt, configName, config, http));
  }
  return await Promise.all(checks);
}

async function checkStockPortfolioConfigs(
  checkedAt: string,
  deps: ThirdPartyHealthDeps,
): Promise<ThirdPartyHealthCheck[]> {
  const configNames = deps.stockPortfolioConfigNames ?? DEFAULT_STOCK_PORTFOLIO_CONFIG_NAMES;
  const loadConfig = deps.loadStockPortfolioConfig ?? loadStockPortfolioProviderConfig;
  return await Promise.all(configNames.map(async (configName) => {
    try {
      const config = loadConfig(configName);
      return okCheck("stock-portfolio", configName, checkedAt, "aggregate", "stock-portfolio source config is loadable", {
        kind: "aggregate",
        safe_details: {
          market_scope: config.market_scope,
          source_count: config.sources.length,
          required_sources: config.sources.filter((source) => source.required).length,
          fail_if_all_sources_fail: config.fail_if_all_sources_fail,
          sources: config.sources.map((source) => ({
            provider: source.provider,
            config: source.config ?? configName,
            required: source.required,
            include_asset_totals: source.include_asset_totals,
          })),
        },
      });
    } catch (err) {
      return errorCheck("stock-portfolio", configName, checkedAt, "aggregate", err, { kind: "aggregate" });
    }
  }));
}

async function checkExtendedThirdPartySources(
  checkedAt: string,
  deps: ThirdPartyHealthDeps,
): Promise<ThirdPartyHealthCheck[]> {
  const groups = await Promise.all([
    checkProviderHealthTargets(checkedAt, deps),
    checkYahooCanaries(checkedAt, deps),
    checkWechatProfiles(checkedAt, deps),
    checkEmailTargets(checkedAt, deps),
    checkMarketIntelOfficialSources(checkedAt, deps),
    checkStockPortfolioConfigs(checkedAt, deps),
  ]);
  return groups.flat();
}

export async function runThirdPartyHealthCheck(deps: ThirdPartyHealthDeps = {}): Promise<ThirdPartyHealthReport> {
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  const baseGroups = await Promise.all([
    checkFutuProfiles(checkedAt, {
      loadFutuConfig: deps.loadFutuConfig ?? loadFutuStockConfig,
      futuClient: deps.futuClient ?? new PythonFutuStockClient(),
    }),
    checkEastmoneyProfiles(checkedAt, {
      loadEastmoneyConfig: deps.loadEastmoneyConfig ?? loadEastmoneyJywgConfig,
      eastmoneyClient: deps.eastmoneyClient ?? new HttpEastmoneyJywgClient(),
      loadEastmoneySession: deps.loadEastmoneySession ?? loadEastmoneyJywgSession,
      saveEastmoneySession: deps.saveEastmoneySession ?? saveEastmoneyJywgSession,
    }),
  ]);
  const extended = deps.includeExtendedChecks === false
    ? []
    : await checkExtendedThirdPartySources(checkedAt, deps);
  const checks = [...baseGroups.flat(), ...extended];
  return {
    checked_at: checkedAt,
    ok: checks.every((check) => check.status !== "error"),
    checks,
  };
}

function actionHint(check: ThirdPartyHealthCheck): string {
  if (check.provider === "eastmoney-jywg" || check.provider === "eastmoney-jywg-readonly") {
    return "运行 `pnpm eastmoney-jywg:login` 重新完成可见浏览器登录/校验。";
  }
  if (check.provider === "futu-stock" && check.stage === "health") {
    return "确认 Futu OpenD/Moomoo OpenD 正在运行，且配置中的 Python 能 import `futu` 或 `moomoo`。";
  }
  if (check.provider === "wechat-mp") {
    return `运行 \`pnpm wechat-mp:login -- --config ${check.profile}\` 后再运行 \`pnpm wechat-mp:check -- --config ${check.profile}\`。`;
  }
  if (check.kind === "email") {
    return "检查 email profile、IMAP 连通性和 app password / secret 配置。";
  }
  if (check.provider === "yahoo" || check.kind === "official" || check.provider === "eastmoney-etf-premium") {
    return "检查本机网络、代理、上游限流或第三方接口返回格式是否变化。";
  }
  if (check.provider === "stock-portfolio") {
    return "检查 stock-portfolio 引用的 source config 是否存在，并分别查看上游 provider health。";
  }
  return "查看 MiniClaw provider 配置和最近 cron 日志后重试。";
}

export function formatThirdPartyHealthIssueReport(report: ThirdPartyHealthReport): string {
  const issues = report.checks.filter((check) => check.status === "error");
  if (issues.length === 0) return "";

  const lines = [
    "⚠️ **MiniClaw 第三方连接健康检查**",
    "",
    `时间：${report.checked_at}`,
    `异常数：${issues.length}`,
    "",
  ];

  for (const issue of issues) {
    const target = `${issue.provider}/${issue.profile}`;
    const category = issue.category ? `，category=${issue.category}` : "";
    lines.push(`- **${target}**：${issue.stage} 异常${category}，${issue.detail}`);
    if (issue.last_verified_at) lines.push(`  - 上次验证：${issue.last_verified_at}`);
    if (issue.cookie_count !== undefined) lines.push(`  - cookie_count：${issue.cookie_count}`);
    if (issue.latency_ms !== undefined) lines.push(`  - latency_ms：${Math.round(issue.latency_ms)}`);
    lines.push(`  - 建议：${actionHint(issue)}`);
  }

  lines.push("");
  lines.push("正常连接不会发送通知；只有异常会出现在这个频道。");
  return lines.join("\n");
}

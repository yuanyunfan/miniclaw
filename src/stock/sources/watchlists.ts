import { loadEastmoneyMyfavorConfig, resolveEastmoneyMyfavorProfile } from "../../mcp/eastmoney-myfavor/config.js";
import { HttpEastmoneyMyfavorClient } from "../../mcp/eastmoney-myfavor/client.js";
import { loadEastmoneyMyfavorSession } from "../../mcp/eastmoney-myfavor/session-vault.js";
import type { EastmoneyMyfavorSecurity } from "../../mcp/eastmoney-myfavor/types.js";
import { loadFutuStockConfig, resolveFutuStockProfile } from "../../mcp/futu-stock/config.js";
import { getFutuWatchlistSecuritiesResult } from "../../mcp/futu-stock/futu-client.js";
import { sanitizeError } from "../../mcp/futu-stock/safety.js";
import type { FutuWatchlistResult, FutuWatchlistSecurity } from "../../mcp/futu-stock/types.js";
import type {
  StockPulseMarket,
  StockPulseUniverseSourceConfig,
  StockPulseUniverseSourceResult,
  StockPulseUniverseSymbol,
} from "../data/pulse-types.js";

const FUTU_WATCHLIST_RAW_FETCH_FLOOR = 1000;
const FUTU_WATCHLIST_RAW_FETCH_CAP = 5000;

interface FutuWatchlistBatch {
  profileName: string;
  groups?: string[];
  sources: StockPulseUniverseSourceConfig[];
}

export class WatchlistSourceUnavailableError extends Error {
  readonly warnings: string[];

  constructor(message: string, warnings: string[] = []) {
    super(message);
    this.name = "WatchlistSourceUnavailableError";
    this.warnings = warnings;
  }
}

function marketFromFutuCode(code: string): StockPulseMarket | undefined {
  const upper = code.trim().toUpperCase();
  if (upper.startsWith("US.")) return "us";
  if (upper.startsWith("HK.")) return "hk";
  if (upper.startsWith("SH.") || upper.startsWith("SZ.")) return "cn-a";
  return undefined;
}

function symbolFromFutuCode(code: string): string {
  const upper = code.trim().toUpperCase();
  if (upper.startsWith("US.") || upper.startsWith("HK.") || upper.startsWith("SH.") || upper.startsWith("SZ.")) {
    return upper.slice(3);
  }
  return upper;
}

function marketFromEastmoneyFlag(flag: string | undefined): StockPulseMarket | undefined {
  if (flag === "105" || flag === "106") return "us";
  if (flag === "116") return "hk";
  if (flag === "0" || flag === "1") return "cn-a";
  return undefined;
}

export function mapFutuWatchlistSymbols(
  rows: FutuWatchlistSecurity[],
  source: StockPulseUniverseSourceConfig,
): StockPulseUniverseSymbol[] {
  return rows.map((row): StockPulseUniverseSymbol | undefined => {
    const market = marketFromFutuCode(row.code);
    if (market !== source.market) return undefined;
    return {
      symbol: symbolFromFutuCode(row.code),
      name: row.name,
      market,
      source: `universe:${source.name}:${row.group_name || "watchlist"}`,
    };
  }).filter((item): item is StockPulseUniverseSymbol => item !== undefined).slice(0, source.limit);
}

function futuGroupsKey(groups: string[] | undefined): string {
  return (groups ?? []).map((group) => group.trim()).filter(Boolean).sort().join("\u0000");
}

function futuBatchKey(source: StockPulseUniverseSourceConfig): string {
  return `${source.profile ?? "default"}\u0001${futuGroupsKey(source.groups)}`;
}

function futuRawFetchLimit(sources: StockPulseUniverseSourceConfig[]): number {
  const requested = sources.reduce((sum, source) => sum + Math.max(0, source.limit), 0);
  return Math.min(FUTU_WATCHLIST_RAW_FETCH_CAP, Math.max(FUTU_WATCHLIST_RAW_FETCH_FLOOR, requested));
}

function futuBatches(sources: StockPulseUniverseSourceConfig[]): FutuWatchlistBatch[] {
  const batches = new Map<string, FutuWatchlistBatch>();
  for (const source of sources) {
    const key = futuBatchKey(source);
    const existing = batches.get(key);
    if (existing) {
      existing.sources.push(source);
      continue;
    }
    batches.set(key, {
      profileName: source.profile ?? "default",
      groups: source.groups,
      sources: [source],
    });
  }
  return [...batches.values()];
}

function futuResultWarnings(profileName: string, result: FutuWatchlistResult): string[] {
  if (!result.group_errors.length) return [];
  const first = result.group_errors[0];
  const prefix = result.rate_limited ? "rate-limited" : "partial";
  return [
    `futu watchlist profile ${profileName} ${prefix}: ${result.group_errors.length}/${result.group_count} group(s) failed${first ? `; first=${first.group_name || "unknown"}: ${first.error}` : ""}`,
  ];
}

function futuResultUnavailable(result: FutuWatchlistResult): boolean {
  return result.group_count > 0 && result.securities.length === 0 && result.group_errors.length >= result.group_count;
}

function unavailableResult(
  source: StockPulseUniverseSourceConfig,
  message: string,
  warnings: string[] = [message],
): StockPulseUniverseSourceResult {
  return {
    source,
    symbols: [],
    warnings,
    error: message,
    unavailable: true,
  };
}

export async function getFutuWatchlistUniverseSymbolsBatch(
  sources: StockPulseUniverseSourceConfig[],
): Promise<StockPulseUniverseSourceResult[]> {
  const futuSources = sources.filter((source) => source.type === "futu_watchlist");
  const results = new Map<StockPulseUniverseSourceConfig, StockPulseUniverseSourceResult>();
  if (!futuSources.length) return [];

  const config = loadFutuStockConfig();
  for (const batch of futuBatches(futuSources)) {
    try {
      const profile = resolveFutuStockProfile(config, batch.profileName);
      const result = await getFutuWatchlistSecuritiesResult(profile, {
        groups: batch.groups,
        limit: futuRawFetchLimit(batch.sources),
      });
      const warnings = futuResultWarnings(batch.profileName, result);
      const unavailable = futuResultUnavailable(result);
      for (const source of batch.sources) {
        results.set(source, {
          source,
          symbols: mapFutuWatchlistSymbols(result.securities, source),
          warnings,
          unavailable,
          error: unavailable ? warnings[0] ?? `futu watchlist profile ${batch.profileName} unavailable` : undefined,
        });
      }
    } catch (err) {
      const message = `futu watchlist profile ${batch.profileName} failed: ${sanitizeError(err)}`;
      for (const source of batch.sources) results.set(source, unavailableResult(source, message));
    }
  }

  return futuSources.map((source) => results.get(source) ?? unavailableResult(source, `futu watchlist source ${source.name} was not collected`));
}

export function mapEastmoneyMyfavorSymbols(
  rows: EastmoneyMyfavorSecurity[],
  source: StockPulseUniverseSourceConfig,
): StockPulseUniverseSymbol[] {
  return rows.map((row): StockPulseUniverseSymbol | undefined => {
    const market = marketFromEastmoneyFlag(row.market_flag);
    if (market !== source.market) return undefined;
    return {
      symbol: row.code.toUpperCase(),
      name: row.name,
      market,
      source: `universe:${source.name}:${row.group_name}`,
    };
  }).filter((item): item is StockPulseUniverseSymbol => item !== undefined).slice(0, source.limit);
}

export async function getFutuWatchlistUniverseSymbols(
  source: StockPulseUniverseSourceConfig,
): Promise<StockPulseUniverseSymbol[]> {
  const [result] = await getFutuWatchlistUniverseSymbolsBatch([source]);
  if (!result) return [];
  if (result.unavailable) {
    throw new WatchlistSourceUnavailableError(result.error ?? `futu watchlist source ${source.name} unavailable`, result.warnings);
  }
  return result.symbols;
}

export async function getEastmoneyMyfavorUniverseSymbols(
  source: StockPulseUniverseSourceConfig,
): Promise<StockPulseUniverseSymbol[]> {
  const config = loadEastmoneyMyfavorConfig();
  const profile = resolveEastmoneyMyfavorProfile(config, source.config ?? source.profile ?? "default");
  const session = loadEastmoneyMyfavorSession(profile.session_secret_path);
  const client = new HttpEastmoneyMyfavorClient();
  const result = await client.getSecurities(profile, session, {
    groups: source.groups,
    limit: source.limit,
  });
  return mapEastmoneyMyfavorSymbols(result.securities, source);
}

export const __testables = {
  marketFromFutuCode,
  symbolFromFutuCode,
  marketFromEastmoneyFlag,
  futuRawFetchLimit,
  futuBatches,
};

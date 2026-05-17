import { loadEastmoneyMyfavorConfig, resolveEastmoneyMyfavorProfile } from "../../mcp/eastmoney-myfavor/config.js";
import { HttpEastmoneyMyfavorClient } from "../../mcp/eastmoney-myfavor/client.js";
import { loadEastmoneyMyfavorSession } from "../../mcp/eastmoney-myfavor/session-vault.js";
import type { EastmoneyMyfavorSecurity } from "../../mcp/eastmoney-myfavor/types.js";
import { loadFutuStockConfig, resolveFutuStockProfile } from "../../mcp/futu-stock/config.js";
import { getFutuWatchlistSecurities } from "../../mcp/futu-stock/futu-client.js";
import type { FutuWatchlistSecurity } from "../../mcp/futu-stock/types.js";
import type { StockPulseMarket, StockPulseUniverseSourceConfig, StockPulseUniverseSymbol } from "../data/pulse-types.js";

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
  const config = loadFutuStockConfig();
  const profile = resolveFutuStockProfile(config, source.profile ?? "default");
  const securities = await getFutuWatchlistSecurities(profile, {
    groups: source.groups,
    limit: source.limit,
  });
  return mapFutuWatchlistSymbols(securities, source);
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
};

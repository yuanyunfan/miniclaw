import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { runEastmoneyJywgProvider } from "../eastmoney-jywg-readonly/index.js";
import { runFutuStockProvider } from "../futu-stock/index.js";
import { loadStockPortfolioProviderConfig } from "./config.js";
import { buildStockPortfolioPayload, formatStockPortfolioPayload, sanitizeStockPortfolioError } from "./format.js";
import type {
  StockPortfolioProviderConfig,
  StockPortfolioSourceConfig,
  StockPortfolioSourceResult,
  StockPortfolioSourceRunner,
} from "./types.js";

const SOURCE_RUNNERS: Record<string, StockPortfolioSourceRunner> = {
  "futu-stock": runFutuStockProvider,
  "eastmoney-jywg-readonly": runEastmoneyJywgProvider,
};

export interface StockPortfolioProviderDeps {
  loadProviderConfig?: (name?: string) => StockPortfolioProviderConfig;
  runners?: Partial<Record<string, StockPortfolioSourceRunner>>;
}

function parseProviderPayload(text: string, source: StockPortfolioSourceConfig): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${source.provider}/${source.config ?? "default"} returned invalid JSON: ${sanitizeStockPortfolioError(err)}`);
  }
}

export async function runStockPortfolioProvider(
  args: PreProviderRunArgs,
  deps: StockPortfolioProviderDeps = {},
): Promise<PreProviderResult> {
  const configName = args.configName ?? "default";
  const config = (deps.loadProviderConfig ?? loadStockPortfolioProviderConfig)(configName);
  const commits: Array<() => Promise<void>> = [];
  const results: StockPortfolioSourceResult[] = [];

  for (const source of config.sources) {
    const runner = deps.runners?.[source.provider] ?? SOURCE_RUNNERS[source.provider];
    const sourceConfig = source.config ?? configName;
    if (!runner) throw new Error(`stock-portfolio source runner not found: ${source.provider}`);
    try {
      const result = await runner({ ...args, configName: sourceConfig });
      const payload = parseProviderPayload(result.text, source);
      results.push({
        provider: source.provider,
        config: sourceConfig,
        label: source.label,
        status: "ok",
        payload,
      });
      if (result.commit) commits.push(result.commit);
    } catch (err) {
      const error = sanitizeStockPortfolioError(err);
      if (source.required || !config.continue_on_error) {
        throw new Error(`stock-portfolio source failed: ${source.provider}/${sourceConfig}: ${error}`);
      }
      results.push({
        provider: source.provider,
        config: sourceConfig,
        label: source.label,
        status: "error",
        error,
      });
    }
  }

  const okCount = results.filter((result) => result.status === "ok").length;
  if (okCount === 0 && config.fail_if_all_sources_fail) {
    const errors = results
      .filter((result) => result.status === "error")
      .map((result) => `${result.provider}/${result.config}: ${result.error}`)
      .join("; ");
    throw new Error(`stock-portfolio provider failed: all sources failed${errors ? `: ${errors}` : ""}`);
  }

  const payload = buildStockPortfolioPayload({
    generatedAt: args.runAt,
    profile: configName,
    config,
    sources: results,
  });
  return {
    text: formatStockPortfolioPayload(payload),
    commit: async () => {
      for (const commit of commits) await commit();
    },
  };
}

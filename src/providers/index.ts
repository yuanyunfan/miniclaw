import type { PreProviderResult, PreProviderRunArgs } from "./types.js";
import type { ProviderDryRunResult, ProviderHealthResult, ProviderManifest, ProviderModule } from "./framework.js";
import { providerContextFromPreProviderArgs, runProviderModuleAsPreProvider } from "./framework.js";
import { runCmbCreditCardEmailProvider } from "./cmb-credit-card-email/index.js";
import { eastmoneyEtfPremiumProvider, runEastmoneyEtfPremiumProvider } from "./eastmoney-etf-premium/index.js";
import { eastmoneyJywgProvider, runEastmoneyJywgProvider } from "./eastmoney-jywg-readonly/index.js";
import { runEmailQueryProvider } from "./email-query/index.js";
import { runFutuStockProvider } from "./futu-stock/index.js";
import { runMarketForecastEvaluationProvider } from "./market-forecast-evaluation/index.js";
import { marketContextProvider, runMarketContextProvider } from "./market-context/index.js";
import { runMarketIntelProvider } from "./market-intel/index.js";
import { runStockPulseProvider, stockPulseProvider } from "./stock-pulse/index.js";
import { runStockWatchlistResearchProvider, stockWatchlistResearchProvider } from "./stock-watchlist-research/index.js";
import { runStockPortfolioProvider } from "./stock-portfolio/index.js";
import { runWechatMpProvider } from "./wechat-mp/index.js";

const PRE_PROVIDERS = {
  "cmb-credit-card-email": runCmbCreditCardEmailProvider,
  "eastmoney-etf-premium": runEastmoneyEtfPremiumProvider,
  "eastmoney-jywg-readonly": runEastmoneyJywgProvider,
  "email-query": runEmailQueryProvider,
  "futu-stock": runFutuStockProvider,
  "market-forecast-evaluation": runMarketForecastEvaluationProvider,
  "market-context": runMarketContextProvider,
  "market-intel": runMarketIntelProvider,
  "stock-pulse": runStockPulseProvider,
  "stock-watchlist-research": runStockWatchlistResearchProvider,
  "stock-portfolio": runStockPortfolioProvider,
  "wechat-mp": runWechatMpProvider,
} as const;

export type PreProviderName = keyof typeof PRE_PROVIDERS;

const PROVIDER_MODULES: Partial<Record<PreProviderName, ProviderModule<any>>> = {
  "eastmoney-etf-premium": eastmoneyEtfPremiumProvider,
  "eastmoney-jywg-readonly": eastmoneyJywgProvider,
  "market-context": marketContextProvider,
  "stock-pulse": stockPulseProvider,
  "stock-watchlist-research": stockWatchlistResearchProvider,
};

export function listPreProviderNames(): PreProviderName[] {
  return Object.keys(PRE_PROVIDERS).sort() as PreProviderName[];
}

export function listProviderManifests(): ProviderManifest[] {
  return Object.values(PROVIDER_MODULES)
    .map((provider) => provider?.manifest)
    .filter((manifest): manifest is ProviderManifest => manifest !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isPreProviderName(name: string): name is PreProviderName {
  return name in PRE_PROVIDERS;
}

export function getProviderManifest(name: string): ProviderManifest | undefined {
  return isPreProviderName(name) ? PROVIDER_MODULES[name]?.manifest : undefined;
}

export function getProviderModule(name: string): ProviderModule<any> | undefined {
  return isPreProviderName(name) ? PROVIDER_MODULES[name] : undefined;
}

export async function runProviderAsPreProvider(name: string, args: PreProviderRunArgs): Promise<PreProviderResult> {
  if (!isPreProviderName(name)) {
    throw new Error(`unknown pre_provider: ${name}`);
  }
  const provider = PROVIDER_MODULES[name];
  if (provider) return await runProviderModuleAsPreProvider(provider, args);
  return await PRE_PROVIDERS[name](args);
}

export async function runPreProvider(name: string, args: PreProviderRunArgs): Promise<PreProviderResult> {
  return await runProviderAsPreProvider(name, args);
}

export async function runProviderHealthCheck(name: string, args: PreProviderRunArgs): Promise<ProviderHealthResult> {
  if (!isPreProviderName(name)) {
    throw new Error(`unknown pre_provider: ${name}`);
  }
  const provider = PROVIDER_MODULES[name];
  if (!provider?.healthCheck) {
    throw new Error(`provider ${name} does not support health checks`);
  }
  return await provider.healthCheck(providerContextFromPreProviderArgs(args));
}

export async function runProviderDryRun(name: string, args: PreProviderRunArgs): Promise<ProviderDryRunResult> {
  if (!isPreProviderName(name)) {
    throw new Error(`unknown pre_provider: ${name}`);
  }
  const provider = PROVIDER_MODULES[name];
  if (!provider?.dryRun) {
    throw new Error(`provider ${name} does not support dry-run`);
  }
  return await provider.dryRun(providerContextFromPreProviderArgs(args));
}

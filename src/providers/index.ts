import type { PreProviderResult, PreProviderRunArgs } from "./types.js";
import { runCmbCreditCardEmailProvider } from "./cmb-credit-card-email/index.js";
import { runEastmoneyJywgProvider } from "./eastmoney-jywg-readonly/index.js";
import { runEmailQueryProvider } from "./email-query/index.js";
import { runFutuStockProvider } from "./futu-stock/index.js";
import { runMarketForecastEvaluationProvider } from "./market-forecast-evaluation/index.js";
import { runMarketIntelProvider } from "./market-intel/index.js";
import { runStockPulseProvider } from "./stock-pulse/index.js";
import { runStockPortfolioProvider } from "./stock-portfolio/index.js";
import { runWechatMpProvider } from "./wechat-mp/index.js";

const PRE_PROVIDERS = {
  "cmb-credit-card-email": runCmbCreditCardEmailProvider,
  "eastmoney-jywg-readonly": runEastmoneyJywgProvider,
  "email-query": runEmailQueryProvider,
  "futu-stock": runFutuStockProvider,
  "market-forecast-evaluation": runMarketForecastEvaluationProvider,
  "market-intel": runMarketIntelProvider,
  "stock-pulse": runStockPulseProvider,
  "stock-portfolio": runStockPortfolioProvider,
  "wechat-mp": runWechatMpProvider,
} as const;

export type PreProviderName = keyof typeof PRE_PROVIDERS;

export function listPreProviderNames(): PreProviderName[] {
  return Object.keys(PRE_PROVIDERS).sort() as PreProviderName[];
}

export function isPreProviderName(name: string): name is PreProviderName {
  return name in PRE_PROVIDERS;
}

export async function runPreProvider(name: string, args: PreProviderRunArgs): Promise<PreProviderResult> {
  if (!isPreProviderName(name)) {
    throw new Error(`unknown pre_provider: ${name}`);
  }
  return await PRE_PROVIDERS[name](args);
}

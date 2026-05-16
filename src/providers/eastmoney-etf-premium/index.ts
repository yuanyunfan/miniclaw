import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import type { ProviderContext, ProviderDryRunResult, ProviderManifest, ProviderModule } from "../framework.js";
import {
  providerDryRunFromError,
  providerHealthFromError,
  runProviderModuleAsPreProvider,
  safeProviderErrorMessage,
} from "../framework.js";
import { EastmoneyFundSelectorPremiumClient } from "./client.js";
import { loadEastmoneyEtfPremiumProviderConfig } from "./config.js";
import type {
  EastmoneyEtfPremiumClient,
  EastmoneyEtfPremiumItem,
  EastmoneyEtfPremiumPayload,
  EastmoneyEtfPremiumProviderConfig,
  EastmoneyEtfPremiumSymbolConfig,
} from "./types.js";

export interface EastmoneyEtfPremiumProviderDeps {
  loadProviderConfig?: (name?: string) => EastmoneyEtfPremiumProviderConfig;
  client?: EastmoneyEtfPremiumClient;
}

export const eastmoneyEtfPremiumProviderManifest: ProviderManifest = {
  name: "eastmoney-etf-premium",
  kind: "stock",
  privacy: "public",
  sideEffects: "none",
  supportsDryRun: true,
  supportsHealthCheck: true,
  outputSchemaVersion: "eastmoney-etf-premium.payload.v1",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index;
      const item = items[index];
      index += 1;
      if (item !== undefined) out[currentIndex] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return out;
}

function missingItem(symbol: EastmoneyEtfPremiumSymbolConfig, capturedAt: string, note: string): EastmoneyEtfPremiumItem {
  return {
    code: symbol.code,
    name: symbol.name ?? symbol.code,
    configured_name: symbol.name,
    data_source: "eastmoney_fund_selector",
    status: "missing_from_eastmoney_fund_selector",
    captured_at: capturedAt,
    note,
  };
}

export function mapEastmoneyFundSelectorRow(
  symbol: EastmoneyEtfPremiumSymbolConfig,
  row: Record<string, unknown> | undefined,
  capturedAt: string,
): EastmoneyEtfPremiumItem {
  if (!row) {
    return missingItem(symbol, capturedAt, "Eastmoney fund selector returned no row for this ETF code.");
  }
  const discountRatio = num(row.PREMIUM_DISCOUNT_RATIO);
  const name = str(row.SECURITY_NAME_ABBR, symbol.name ?? symbol.code);
  const base: EastmoneyEtfPremiumItem = {
    code: str(row.SECURITY_CODE, symbol.code),
    name,
    configured_name: symbol.name,
    secucode: str(row.SECUCODE) || undefined,
    index_name: str(row.INDEX_NAME) || undefined,
    data_source: "eastmoney_fund_selector",
    status: discountRatio === undefined ? "missing_from_eastmoney_fund_selector" : "ok",
    captured_at: capturedAt,
    latest_price: num(row.NEW_PRICE),
    change_rate: num(row.CHANGE_RATE),
    volume: num(row.VOLUME),
    deal_amount: num(row.DEAL_AMOUNT),
    quantity_relative_ratio: num(row.QUANTITY_RELATIVE_RATIO),
    high_price: num(row.HIGH_PRICE),
    low_price: num(row.LOW_PRICE),
    pre_close_price: num(row.PRE_CLOSE_PRICE),
    dec_nav: num(row.DEC_NAV),
    dec_totalshare: num(row.DEC_TOTALSHARE),
  };
  if (discountRatio === undefined) {
    return {
      ...base,
      note: "Eastmoney fund selector row did not include PREMIUM_DISCOUNT_RATIO.",
    };
  }
  return {
    ...base,
    eastmoney_discount_ratio: discountRatio,
    premium_rate: roundPercent(-discountRatio),
  };
}

async function runEastmoneyEtfPremiumStructured(
  context: ProviderContext,
  deps: EastmoneyEtfPremiumProviderDeps = {},
): Promise<EastmoneyEtfPremiumPayload> {
  const profile = context.configName ?? "default";
  const config = (deps.loadProviderConfig ?? loadEastmoneyEtfPremiumProviderConfig)(profile);
  const client = deps.client ?? new EastmoneyFundSelectorPremiumClient();
  const capturedAt = context.runAt.toISOString();
  const warnings: string[] = [];
  const items = await mapLimit(config.symbols, config.concurrency, async (symbol) => {
    try {
      return mapEastmoneyFundSelectorRow(symbol, await client.getFundSelectorRow(symbol.code, config.timeout_ms), capturedAt);
    } catch (err) {
      const message = safeProviderErrorMessage(err);
      warnings.push(`${symbol.code}: ${message}`);
      return missingItem(symbol, capturedAt, `Eastmoney fund selector request failed: ${message}`);
    }
  });
  const missingCount = items.filter((item) => item.status !== "ok").length;
  if (missingCount > 0) warnings.push(`${missingCount} ETF premium row(s) missing PREMIUM_DISCOUNT_RATIO from Eastmoney fund selector.`);

  return {
    generated_at: capturedAt,
    source: "eastmoney-etf-premium",
    profile,
    premium_summary: {
      source: "eastmoney_fund_selector",
      items,
      warnings,
      usage_notes: [
        "Eastmoney fund selector exposes PREMIUM_DISCOUNT_RATIO as a discount-rate field; MiniClaw maps premium_rate = 0 - PREMIUM_DISCOUNT_RATIO.",
        "This provider is public market data only. It does not prove the ETF is held in the account; stock-portfolio must anchor rows to broker holdings before using it as position premium evidence.",
        "DEC_NAV is emitted as Eastmoney's raw DEC_NAV field and is not treated as per-share NAV/IOPV.",
      ],
    },
    warnings,
    usage_notes: [
      "Use premium_summary.items only as public ETF premium evidence by code.",
      "Do not treat this provider as an account holding source or as a trading/order signal.",
    ],
  };
}

export const eastmoneyEtfPremiumProvider: ProviderModule<EastmoneyEtfPremiumPayload> = {
  manifest: eastmoneyEtfPremiumProviderManifest,
  async healthCheck(context) {
    try {
      const profile = context.configName ?? "default";
      const config = loadEastmoneyEtfPremiumProviderConfig(profile);
      const client = new EastmoneyFundSelectorPremiumClient();
      const first = config.symbols[0];
      if (!first) throw new Error("eastmoney-etf-premium provider config requires at least one symbol");
      const row = await client.getFundSelectorRow(first.code, config.timeout_ms);
      if (!isRecord(row)) throw new Error(`Eastmoney fund selector returned no row for ${first.code}`);
      return {
        ok: true,
        message: `eastmoney-etf-premium config ok: ${profile}`,
        checkedAt: new Date().toISOString(),
        safeDetails: {
          symbols: config.symbols.map((symbol) => symbol.code),
          probe_code: first.code,
          has_premium_discount_ratio: num(row.PREMIUM_DISCOUNT_RATIO) !== undefined,
        },
      };
    } catch (err) {
      return providerHealthFromError(err);
    }
  },
  async dryRun(context): Promise<ProviderDryRunResult<EastmoneyEtfPremiumPayload>> {
    try {
      const structured = await runEastmoneyEtfPremiumStructured(context);
      const okCount = structured.premium_summary.items.filter((item) => item.status === "ok").length;
      return {
        ok: okCount > 0,
        category: okCount > 0 ? undefined : "data_absence",
        structured,
        previewText: `eastmoney-etf-premium symbols=${structured.premium_summary.items.length}; ok=${okCount}; warnings=${structured.warnings.length}`,
        redacted: true,
        warnings: structured.warnings,
      };
    } catch (err) {
      return providerDryRunFromError(err);
    }
  },
  async run(context) {
    return await runEastmoneyEtfPremiumStructured(context);
  },
  async format(result): Promise<PreProviderResult> {
    return { text: JSON.stringify(result, null, 2) };
  },
};

export async function runEastmoneyEtfPremiumProvider(
  args: PreProviderRunArgs,
  deps: EastmoneyEtfPremiumProviderDeps = {},
): Promise<PreProviderResult> {
  if (Object.keys(deps).length === 0) {
    return await runProviderModuleAsPreProvider(eastmoneyEtfPremiumProvider, args);
  }
  const context: ProviderContext = {
    configName: args.configName,
    jobName: args.jobName,
    channelId: args.channelId,
    runAt: args.runAt,
  };
  const structured = await runEastmoneyEtfPremiumStructured(context, deps);
  return await eastmoneyEtfPremiumProvider.format(structured, context);
}

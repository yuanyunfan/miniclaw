import type { MarketContextItemRow, MarketContextScope } from "../../store/market-context.js";
import type { MarketForecastItemRow, MarketForecastRow } from "../../store/market-forecasts.js";

export type MarketContextProviderMode = "update" | "inject";

export interface MarketContextProviderConfig {
  mode: MarketContextProviderMode;
  timezone: string;
  market_scope?: MarketContextScope;
  market_scopes: MarketContextScope[];
  forecast_market_scope?: string;
  forecast_session: string;
  lookback_days: number;
  max_items: number;
  max_digest_chars: number;
}

export interface MarketContextDailySummary {
  id: string;
  market_scope: MarketContextScope;
  trade_date: string;
  generated_at: string;
  digest_text: string;
  active_items: unknown[];
  data_quality: unknown;
}

export interface MarketContextForecastSummary {
  id: string;
  market_scope: string;
  trade_date: string;
  session: string;
  generated_at: string;
  data_quality_status: string | null;
  report_excerpt?: string;
  items: Array<Pick<MarketForecastItemRow,
    "item_type" | "target" | "direction" | "probability" | "confidence" | "evidence_ids_json" | "rationale" | "source">>;
}

export interface MarketContextProviderPayload {
  generated_at: string;
  source: "market-context";
  profile: string;
  mode: MarketContextProviderMode;
  run_context: {
    job_name: string;
    channel_id: string;
    timezone: string;
    trade_date: string;
    target_market_scope?: MarketContextScope;
    requested_market_scopes: MarketContextScope[];
  };
  previous_contexts: MarketContextDailySummary[];
  active_items: MarketContextItemRow[];
  latest_forecast?: MarketContextForecastSummary;
  usage_notes: string[];
}

export type MarketContextForecastLoader = (params: {
  marketScope: string;
  tradeDate?: string;
  session?: string;
}) => MarketForecastRow | undefined;

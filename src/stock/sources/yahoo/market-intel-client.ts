import type {
  MarketIntelQuoteClient,
  MarketIntelQuoteRequest,
  MarketIntelQuoteSnapshotInput,
} from "../../data/market-intel-types.js";
import { fetchYahooChartSeries } from "./index.js";

export class YahooMarketIntelQuoteClient implements MarketIntelQuoteClient {
  readonly source = "yahoo_chart_unofficial";
  readonly source_tier = "fallback" as const;

  async getSnapshot(request: MarketIntelQuoteRequest): Promise<MarketIntelQuoteSnapshotInput> {
    const series = await fetchYahooChartSeries({
      providerSymbol: request.provider_symbol,
      range: "5d",
      interval: "5m",
      includePrePost: true,
      timeoutMs: 8000,
      userAgent: "MiniClaw/0.4 market-intel",
    });
    if (series.latest_at === undefined || series.latest_price === undefined) {
      throw new Error(`yahoo chart returned no quote for ${request.provider_symbol}`);
    }
    return {
      symbol: request.symbol,
      provider_symbol: request.provider_symbol,
      latest_at: series.latest_at,
      latest_price: series.latest_price,
      previous_close: series.previous_close,
      currency: series.currency,
    };
  }
}

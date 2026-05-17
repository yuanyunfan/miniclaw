import { zonedDateKey } from "../data/calendar.js";
import type {
  StockPulseAlert,
  StockPulseBaseline,
  StockPulsePositionSnapshot,
  StockPulseQuoteBar,
  StockPulseQuoteSeries,
  StockPulseSymbol,
  StockPulseThresholdConfig,
  StockPulseThresholdRule,
} from "../../providers/stock-pulse/types.js";

const HOUR_WINDOW_BARS = 12;

function pct(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function round(value: number, digits = 2): number {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function returnsForBars(bars: StockPulseQuoteBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (!prev || !cur) continue;
    out.push(pct(prev.close, cur.close));
  }
  return out;
}

function rollingHourReturns(bars: StockPulseQuoteBar[]): number[] {
  const out: number[] = [];
  for (let i = HOUR_WINDOW_BARS; i < bars.length; i++) {
    const start = bars[i - HOUR_WINDOW_BARS];
    const end = bars[i];
    if (!start || !end) continue;
    out.push(pct(start.close, end.close));
  }
  return out;
}

function sameDirectionCount(returns: number[]): { count: number; direction: "up" | "down" | "mixed" } {
  const up = returns.filter((value) => value > 0).length;
  const down = returns.filter((value) => value < 0).length;
  if (up === down) return { count: up, direction: "mixed" };
  return up > down ? { count: up, direction: "up" } : { count: down, direction: "down" };
}

function buildBaseline(bars: StockPulseQuoteBar[], rule: StockPulseThresholdRule): StockPulseBaseline {
  const barReturns = returnsForBars(bars);
  const barStd = std(barReturns.map(Math.abs));
  const threshold = Math.max(rule.bar_abs_pct, barStd * rule.bar_sigma_multiplier);
  const windowCounts: number[] = [];
  for (let i = HOUR_WINDOW_BARS; i < barReturns.length; i++) {
    const window = barReturns.slice(i - HOUR_WINDOW_BARS, i);
    windowCounts.push(window.filter((value) => Math.abs(value) >= threshold).length);
  }
  const hourReturns = rollingHourReturns(bars);
  return {
    bar_return_std_pct: round(barStd, 4),
    hour_return_std_pct: round(std(hourReturns), 4),
    abnormal_bar_count_p95: round(percentile(windowCounts, 95), 2),
    sample_bar_count: barReturns.length,
    sample_hour_window_count: hourReturns.length,
  };
}

function thresholdFor(symbol: StockPulseSymbol, thresholds: StockPulseThresholdConfig): StockPulseThresholdRule {
  return thresholds[symbol.instrument_type];
}

function latestMarketDayOpen(bars: StockPulseQuoteBar[], timezone: string): number | undefined {
  const latest = bars.at(-1);
  if (!latest) return undefined;
  const latestDay = zonedDateKey(new Date(latest.timestamp), timezone);
  return bars.find((bar) => zonedDateKey(new Date(bar.timestamp), timezone) === latestDay)?.close;
}

export function buildStockPulsePositionSnapshot(params: {
  symbol: StockPulseSymbol;
  series: StockPulseQuoteSeries;
  marketTimezone: string;
}): StockPulsePositionSnapshot | undefined {
  const bars = params.series.bars
    .filter((bar) => Number.isFinite(bar.close))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const latest = bars.at(-1);
  if (!latest) return undefined;
  const hourStart = bars.length > HOUR_WINDOW_BARS ? bars.at(-HOUR_WINDOW_BARS - 1) : bars.at(0);
  const dayOpen = latestMarketDayOpen(bars, params.marketTimezone) ?? params.series.previous_close;
  return {
    symbol: params.symbol.symbol,
    yahoo_symbol: params.symbol.yahoo_symbol,
    name: params.symbol.name,
    market: params.symbol.market,
    instrument_type: params.symbol.instrument_type,
    sources: params.symbol.sources,
    latest_price: latest.close,
    price_currency: params.series.currency,
    latest_at: latest.timestamp,
    previous_close: params.series.previous_close,
    hour_return_pct: hourStart && hourStart.timestamp !== latest.timestamp ? round(pct(hourStart.close, latest.close)) : undefined,
    day_return_pct: dayOpen === undefined ? undefined : round(pct(dayOpen, latest.close)),
    portfolio: params.symbol.portfolio,
  };
}

export function analyzeStockPulseSeries(params: {
  symbol: StockPulseSymbol;
  series: StockPulseQuoteSeries;
  thresholds: StockPulseThresholdConfig;
  marketTimezone: string;
}): StockPulseAlert | undefined {
  const bars = params.series.bars
    .filter((bar) => Number.isFinite(bar.close))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (bars.length < HOUR_WINDOW_BARS + 2) return undefined;

  const rule = thresholdFor(params.symbol, params.thresholds);
  const baseline = buildBaseline(bars.slice(0, -HOUR_WINDOW_BARS), rule);
  const recentBars = bars.slice(-HOUR_WINDOW_BARS - 1);
  const recentReturns = returnsForBars(recentBars);
  const barThreshold = Math.max(rule.bar_abs_pct, baseline.bar_return_std_pct * rule.bar_sigma_multiplier);
  const abnormalBarCount = recentReturns.filter((value) => Math.abs(value) >= barThreshold).length;
  const expectedAbnormalCount = Math.max(rule.abnormal_bar_count, Math.ceil(baseline.abnormal_bar_count_p95 + 1));
  const sameDirection = sameDirectionCount(recentReturns);
  const latest = bars.at(-1);
  const hourStart = recentBars.at(0);
  if (!latest || !hourStart) return undefined;

  const hourReturn = pct(hourStart.close, latest.close);
  const dayOpen = latestMarketDayOpen(bars, params.marketTimezone) ?? params.series.previous_close;
  const dayReturn = dayOpen === undefined ? undefined : pct(dayOpen, latest.close);
  const zScore = baseline.hour_return_std_pct > 0
    ? Math.abs(hourReturn) / baseline.hour_return_std_pct
    : Math.abs(hourReturn) > 0
      ? 999
      : undefined;

  const triggers: string[] = [];
  if (Math.abs(hourReturn) >= rule.hour_abs_pct) triggers.push("hour_move");
  if (dayReturn !== undefined && Math.abs(dayReturn) >= rule.day_abs_pct) triggers.push("day_move");
  if (abnormalBarCount >= expectedAbnormalCount) triggers.push("abnormal_frequency");
  if (sameDirection.count >= rule.same_direction_bars && Math.abs(hourReturn) >= rule.hour_abs_pct * 0.5) {
    triggers.push("one_way_bars");
  }
  if (zScore !== undefined && zScore >= rule.z_score) triggers.push("z_score");

  if (!triggers.length) return undefined;

  const urgent = (zScore !== undefined && zScore >= rule.urgent_z_score)
    || (dayReturn !== undefined && Math.abs(dayReturn) >= rule.day_abs_pct * 2)
    || abnormalBarCount >= expectedAbnormalCount + 2;

  return {
    symbol: params.symbol.symbol,
    yahoo_symbol: params.symbol.yahoo_symbol,
    name: params.symbol.name,
    market: params.symbol.market,
    instrument_type: params.symbol.instrument_type,
    sources: params.symbol.sources,
    latest_price: latest.close,
    latest_at: latest.timestamp,
    previous_close: params.series.previous_close,
    hour_return_pct: round(hourReturn),
    day_return_pct: dayReturn === undefined ? undefined : round(dayReturn),
    z_score: zScore === undefined ? undefined : round(zScore, 2),
    abnormal_bar_count: abnormalBarCount,
    abnormal_bar_count_expected_p95: expectedAbnormalCount,
    same_direction_bars: sameDirection.count,
    direction: sameDirection.direction,
    severity: urgent ? "urgent" : triggers.length >= 2 ? "alert" : "notice",
    triggers,
    baseline,
  };
}

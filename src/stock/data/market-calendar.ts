import type {
  MarketIntelCalendarMarketSnapshot,
  MarketIntelCalendarSnapshot,
  MarketIntelCalendarStatus,
  MarketIntelEarlyClose,
  MarketIntelMarket,
  MarketIntelMarketConfig,
  MarketIntelTimeWindow,
} from "./market-intel-types.js";

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`invalid HH:mm time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`invalid HH:mm time: ${value}`);
  }
  return hour * 60 + minute;
}

export function zonedDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function zonedClock(date: Date, timezone: string): { weekday: number; minuteOfDay: number; currentTime: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "";
  const hour = part("hour");
  const minute = part("minute");
  return {
    weekday: WEEKDAY_TO_NUMBER[part("weekday")] ?? 7,
    minuteOfDay: Number(hour) * 60 + Number(minute),
    currentTime: `${hour}:${minute}`,
  };
}

function earlyCloseFor(dateKey: string, earlyCloses: MarketIntelEarlyClose[]): MarketIntelEarlyClose | undefined {
  return earlyCloses.find((item) => item.date === dateKey);
}

function minTime(a: string, b: string): string {
  return parseTimeToMinutes(a) <= parseTimeToMinutes(b) ? a : b;
}

function effectiveSessions(sessions: MarketIntelTimeWindow[], earlyClose?: MarketIntelEarlyClose): MarketIntelTimeWindow[] {
  if (!earlyClose) return sessions;
  const closeMinute = parseTimeToMinutes(earlyClose.close);
  return sessions
    .map((session) => ({
      start: session.start,
      end: minTime(session.end, earlyClose.close),
    }))
    .filter((session) => parseTimeToMinutes(session.start) < closeMinute && parseTimeToMinutes(session.start) < parseTimeToMinutes(session.end));
}

function isMinuteInWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

function marketStatusForMinute(minute: number, sessions: MarketIntelTimeWindow[]): "pre_market" | "open" | "break" | "after_close" {
  const sorted = [...sessions].sort((a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return "after_close";
  if (minute < parseTimeToMinutes(first.start)) return "pre_market";
  if (sorted.some((session) => isMinuteInWindow(minute, parseTimeToMinutes(session.start), parseTimeToMinutes(session.end)))) {
    return "open";
  }
  if (minute >= parseTimeToMinutes(last.end)) return "after_close";
  return "break";
}

export function marketCalendarAt(
  date: Date,
  market: MarketIntelMarket,
  config: MarketIntelMarketConfig,
): MarketIntelCalendarMarketSnapshot {
  const dateKey = zonedDateKey(date, config.timezone);
  const clock = zonedClock(date, config.timezone);
  const earlyClose = earlyCloseFor(dateKey, config.early_closes);
  const sessions = effectiveSessions(config.sessions, earlyClose);
  if (clock.weekday > 5) {
    return {
      market,
      timezone: config.timezone,
      trade_date: dateKey,
      status: "closed",
      reason: "weekend",
      current_time: clock.currentTime,
      sessions,
      early_close: earlyClose?.close,
    };
  }
  if (config.holidays.includes(dateKey)) {
    return {
      market,
      timezone: config.timezone,
      trade_date: dateKey,
      status: "closed",
      reason: "holiday",
      current_time: clock.currentTime,
      sessions,
      early_close: earlyClose?.close,
    };
  }
  if (!sessions.length) {
    return {
      market,
      timezone: config.timezone,
      trade_date: dateKey,
      status: "closed",
      reason: "no_session",
      current_time: clock.currentTime,
      sessions,
      early_close: earlyClose?.close,
    };
  }
  return {
    market,
    timezone: config.timezone,
    trade_date: dateKey,
    status: marketStatusForMinute(clock.minuteOfDay, sessions),
    current_time: clock.currentTime,
    sessions,
    early_close: earlyClose?.close,
  };
}

function aggregateCalendarStatus(markets: MarketIntelCalendarMarketSnapshot[]): MarketIntelCalendarStatus {
  const tradable = markets.filter((market) => market.status !== "closed");
  if (!tradable.length) return "closed";
  if (tradable.length !== markets.length) return "partial";
  const unique = new Set(tradable.map((market) => market.status));
  if (unique.size === 1) return tradable[0]?.status ?? "closed";
  if (unique.has("open")) return "mixed";
  return "mixed";
}

export function buildMarketIntelCalendarSnapshot(params: {
  date: Date;
  timezone: string;
  markets: Partial<Record<MarketIntelMarket, MarketIntelMarketConfig>>;
}): MarketIntelCalendarSnapshot {
  const markets = (Object.entries(params.markets) as Array<[MarketIntelMarket, MarketIntelMarketConfig]>)
    .map(([market, config]) => marketCalendarAt(params.date, market, config));
  const status = aggregateCalendarStatus(markets);
  const openMarkets = markets.filter((market) => market.status === "open").map((market) => market.market);
  const tradableMarkets = markets.filter((market) => market.status !== "closed").map((market) => market.market);
  const closedMarkets = markets.filter((market) => market.status === "closed").map((market) => market.market);
  return {
    status,
    trade_date: zonedDateKey(params.date, params.timezone),
    timezone: params.timezone,
    open_markets: openMarkets,
    tradable_markets: tradableMarkets,
    closed_markets: closedMarkets,
    markets,
  };
}

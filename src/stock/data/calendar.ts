export interface StockTimeWindow {
  timezone: string;
  start: string;
  end: string;
}

export interface StockMarketSession {
  start: string;
  end: string;
}

export interface StockMarketCalendarConfig {
  timezone: string;
  sessions: StockMarketSession[];
  holidays: string[];
}

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

function zonedClock(date: Date, timezone: string): { weekday: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "";
  return {
    weekday: WEEKDAY_TO_NUMBER[part("weekday")] ?? 7,
    minuteOfDay: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

export function isMinuteInWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

export function isActiveWindow(date: Date, window: StockTimeWindow): boolean {
  const clock = zonedClock(date, window.timezone);
  return isMinuteInWindow(clock.minuteOfDay, parseTimeToMinutes(window.start), parseTimeToMinutes(window.end));
}

export function isMarketOpen(date: Date, market: StockMarketCalendarConfig): boolean {
  const clock = zonedClock(date, market.timezone);
  if (clock.weekday > 5) return false;
  if (market.holidays.includes(zonedDateKey(date, market.timezone))) return false;
  return market.sessions.some((session) => (
    isMinuteInWindow(clock.minuteOfDay, parseTimeToMinutes(session.start), parseTimeToMinutes(session.end))
  ));
}

export function openMarketsAt<TMarket extends string>(
  date: Date,
  markets: Partial<Record<TMarket, StockMarketCalendarConfig>>,
): TMarket[] {
  return (Object.entries(markets) as Array<[TMarket, StockMarketCalendarConfig]>)
    .filter(([, config]) => isMarketOpen(date, config))
    .map(([market]) => market);
}

export { buildMarketIntelCalendarSnapshot } from "./market-calendar.js";
export type {
  MarketIntelCalendarSnapshot,
  MarketIntelMarketConfig,
} from "../../providers/market-intel/types.js";

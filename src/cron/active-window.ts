export interface CronActiveWindowConfig {
  enabled: boolean;
  timezone: string;
  start: string;
  end: string;
}

function parseClockTimeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`invalid HH:mm time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function zonedMinuteOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "0";
  return Number(part("hour")) * 60 + Number(part("minute"));
}

function minuteInWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

export function isCronActiveWindowOpen(date: Date, window: CronActiveWindowConfig): boolean {
  if (!window.enabled) return true;
  return minuteInWindow(
    zonedMinuteOfDay(date, window.timezone),
    parseClockTimeToMinutes(window.start),
    parseClockTimeToMinutes(window.end)
  );
}

export function describeCronActiveWindow(window: CronActiveWindowConfig): string {
  return `${window.start}-${window.end} ${window.timezone}`;
}

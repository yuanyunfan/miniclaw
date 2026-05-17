import type { ConfigReader } from "../env.js";

function validateClockTime(value: string, name: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid config ${name}: expected HH:mm`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid config ${name}: expected HH:mm with hour 0-23 and minute 0-59`);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function validateTimezone(value: string, name: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error(`Invalid config ${name}: unknown IANA timezone "${value}"`);
  }
}

export function buildCronRuntimeConfig(reader: ConfigReader) {
  const enabled = reader.boolValue(
    ["cron", "active_window", "enabled"],
    "MINICLAW_CRON_ACTIVE_WINDOW_ENABLED",
    false
  );
  const timezone = validateTimezone(
    reader.requiredString(
      ["cron", "active_window", "timezone"],
      "MINICLAW_CRON_ACTIVE_WINDOW_TIMEZONE",
      "Asia/Shanghai"
    ),
    reader.optionName(["cron", "active_window", "timezone"], "MINICLAW_CRON_ACTIVE_WINDOW_TIMEZONE")
  );
  const start = validateClockTime(
    reader.requiredString(
      ["cron", "active_window", "start"],
      "MINICLAW_CRON_ACTIVE_WINDOW_START",
      "08:00"
    ),
    reader.optionName(["cron", "active_window", "start"], "MINICLAW_CRON_ACTIVE_WINDOW_START")
  );
  const end = validateClockTime(
    reader.requiredString(
      ["cron", "active_window", "end"],
      "MINICLAW_CRON_ACTIVE_WINDOW_END",
      "00:00"
    ),
    reader.optionName(["cron", "active_window", "end"], "MINICLAW_CRON_ACTIVE_WINDOW_END")
  );

  return {
    cron: {
      activeWindow: {
        enabled,
        timezone,
        start,
        end,
      },
    },
  } as const;
}

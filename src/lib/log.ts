type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const envLevel = (process.env.MINICLAW_LOG_LEVEL?.toLowerCase() as Level) || "info";
const minLevel = LEVEL_ORDER[envLevel] ?? LEVEL_ORDER.info;

function fmtPrefix(level: Level, module: string): string {
  const ts = new Date().toISOString();
  const lvl = level.toUpperCase().padEnd(5);
  return `${ts} [${lvl}] [${module}]`;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (...args) => {
      if (LEVEL_ORDER.debug >= minLevel) console.log(fmtPrefix("debug", module), ...args);
    },
    info: (...args) => {
      if (LEVEL_ORDER.info >= minLevel) console.log(fmtPrefix("info", module), ...args);
    },
    warn: (...args) => {
      if (LEVEL_ORDER.warn >= minLevel) console.warn(fmtPrefix("warn", module), ...args);
    },
    error: (...args) => {
      console.error(fmtPrefix("error", module), ...args);
    },
  };
}

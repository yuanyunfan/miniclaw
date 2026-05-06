type Level = "debug" | "info" | "warn" | "error";
type LogFormat = "text" | "json";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentMinLevel(): number {
  const envLevel = (process.env.MINICLAW_LOG_LEVEL?.toLowerCase() as Level) || "info";
  return LEVEL_ORDER[envLevel] ?? LEVEL_ORDER.info;
}

function currentFormat(): LogFormat {
  return process.env.MINICLAW_LOG_FORMAT?.toLowerCase() === "json" ? "json" : "text";
}

function shouldLog(level: Level): boolean {
  return level === "error" || LEVEL_ORDER[level] >= currentMinLevel();
}

function fmtPrefix(level: Level, module: string): string {
  const ts = new Date().toISOString();
  const lvl = level.toUpperCase().padEnd(5);
  return `${ts} [${lvl}] [${module}]`;
}

function argToString(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean" || arg === null || arg === undefined) return String(arg);
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function normalizeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }
  return arg;
}

function formatJsonLine(level: Level, module: string, args: unknown[], now = new Date()): string {
  const record = {
    ts: now.toISOString(),
    level,
    module,
    message: args.map(argToString).join(" "),
    args: args.map(normalizeArg),
  };
  return JSON.stringify(record);
}

function write(level: Level, module: string, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (currentFormat() === "json") {
    sink(formatJsonLine(level, module, args));
    return;
  }
  sink(fmtPrefix(level, module), ...args);
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
      write("debug", module, args);
    },
    info: (...args) => {
      write("info", module, args);
    },
    warn: (...args) => {
      write("warn", module, args);
    },
    error: (...args) => {
      write("error", module, args);
    },
  };
}

export const __testables = { formatJsonLine, shouldLog };

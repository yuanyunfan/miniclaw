import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_LOG_DIR = "~/.miniclaw/logs";
const DOCTOR_LOG_FILES = ["miniclaw-error.log", "miniclaw-out.log"] as const;

export interface DoctorSchedulerState {
  isRunning(): boolean;
  beginRun(): boolean;
  finishRun(): void;
  shouldSkipUnchangedInterval(reason: string, currentLogFingerprint: string | null): boolean;
  rememberLogFingerprint(currentLogFingerprint: string | null): void;
}

export function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function envOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function logDir(): string {
  return resolveHome(envOptional("MINICLAW_LOG_DIR") ?? DEFAULT_LOG_DIR);
}

export function logFingerprint(): string | null {
  try {
    const dir = logDir();
    return DOCTOR_LOG_FILES.map((file) => {
      const path = join(dir, file);
      if (!existsSync(path)) return `${file}:missing`;
      const stat = statSync(path);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    }).join("|");
  } catch {
    return null;
  }
}

export function createDoctorSchedulerState(): DoctorSchedulerState {
  let running = false;
  let lastLogFingerprint: string | null = null;

  return {
    isRunning: () => running,
    beginRun: () => {
      if (running) return false;
      running = true;
      return true;
    },
    finishRun: () => {
      running = false;
    },
    shouldSkipUnchangedInterval: (reason, currentLogFingerprint) => (
      reason === "interval" && Boolean(currentLogFingerprint && currentLogFingerprint === lastLogFingerprint)
    ),
    rememberLogFingerprint: (currentLogFingerprint) => {
      lastLogFingerprint = currentLogFingerprint;
    },
  };
}

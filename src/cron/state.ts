// 持久化 cron 运行状态到 ~/.miniclaw/cron/state.json
// 重启不丢 last_run_at / last_status / completed 计数
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createLogger } from "../lib/log.js";

const log = createLogger("cron-state");

export interface JobState {
  last_run_at: string;
  last_status: "ok" | "error";
  last_error?: string;
  last_duration_ms: number;
  completed: number;
  last_attempt?: number;
  max_attempts?: number;
  next_retry_at?: string;
  failure_run_id?: string;
  failure_alert_message_id?: string;
  failure_alert_channel_id?: string;
}

export type StateFile = {
  updated_at: string;
  jobs: Record<string, JobState>;
};

const DEFAULT_PATH = join(homedir(), ".miniclaw/cron/state.json");

function statePath(): string {
  return process.env.MINICLAW_CRON_STATE ?? DEFAULT_PATH;
}

let cache: StateFile | null = null;

function emptyState(): StateFile {
  return { updated_at: new Date().toISOString(), jobs: {} };
}

export function loadState(): StateFile {
  if (cache) return cache;
  const path = statePath();
  if (!existsSync(path)) {
    cache = emptyState();
    return cache;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as StateFile;
    if (!parsed || typeof parsed !== "object" || !parsed.jobs) {
      cache = emptyState();
    } else {
      cache = parsed;
    }
  } catch (err) {
    log.warn(`解析 ${path} 失败，使用空状态:`, err);
    cache = emptyState();
  }
  return cache;
}

function persist(): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  if (cache) cache.updated_at = new Date().toISOString();
  writeFileSync(tmp, JSON.stringify(cache ?? emptyState(), null, 2), "utf8");
  renameSync(tmp, path);
}

export function recordRun(
  name: string,
  ok: boolean,
  durationMs: number,
  error?: string,
  metadata: Partial<JobState> = {}
): JobState {
  const state = loadState();
  const prev = state.jobs[name];
  const next: JobState = {
    last_run_at: new Date().toISOString(),
    last_status: ok ? "ok" : "error",
    ...(error ? { last_error: error.slice(0, 500) } : {}),
    last_duration_ms: durationMs,
    completed: (prev?.completed ?? 0) + 1,
  };
  for (const [key, value] of Object.entries(metadata) as Array<[keyof JobState, JobState[keyof JobState]]>) {
    if (value !== undefined) {
      (next as Record<keyof JobState, JobState[keyof JobState]>)[key] = value;
    }
  }
  state.jobs[name] = next;
  persist();
  return next;
}

export function updateJobState(
  name: string,
  patch: Partial<JobState>,
  clear: Array<keyof JobState> = []
): JobState | undefined {
  const state = loadState();
  const current = state.jobs[name];
  if (!current) return undefined;

  const next: JobState = { ...current };
  for (const key of clear) {
    delete next[key];
  }
  for (const [key, value] of Object.entries(patch) as Array<[keyof JobState, JobState[keyof JobState]]>) {
    if (value !== undefined) {
      (next as Record<keyof JobState, JobState[keyof JobState]>)[key] = value;
    }
  }
  state.jobs[name] = next;
  persist();
  return next;
}

export function getJobState(name: string): JobState | undefined {
  return loadState().jobs[name];
}

export function getAllJobStates(): Record<string, JobState> {
  return { ...loadState().jobs };
}

// 仅供测试 / 重启 in-process 使用
export function resetStateCache(): void {
  cache = null;
}

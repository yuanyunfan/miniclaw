import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_ACTIVE_CHAT_STATE_PATH = "~/.miniclaw/runtime/active-chats.json";

export interface ActiveChatSummary {
  id: string;
  channel_id: string;
  user_id: string;
  prompt: string;
  started_at: string;
  pid: number;
}

interface ActiveChatStateFile {
  version: 1;
  updated_at: string;
  chats: ActiveChatSummary[];
}

interface ActiveChatEntry {
  summary: ActiveChatSummary;
  controller: AbortController;
}

export interface ActiveChatHandle {
  id: string;
  signal: AbortSignal;
  finish: () => void;
}

const activeChats = new Map<string, ActiveChatEntry>();
const drainWaiters = new Set<() => void>();

function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function envOptional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function resolveActiveChatStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveHome(envOptional(env, "MINICLAW_ACTIVE_CHAT_STATE_PATH") ?? DEFAULT_ACTIVE_CHAT_STATE_PATH);
}

function notifyActiveChatChange(): void {
  if (activeChats.size !== 0) return;
  for (const waiter of drainWaiters) waiter();
}

function persistActiveChatState(): void {
  const statePath = resolveActiveChatStatePath();
  const state: ActiveChatStateFile = {
    version: 1,
    updated_at: new Date().toISOString(),
    chats: Array.from(activeChats.values()).map((entry) => entry.summary),
  };
  mkdirSync(dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, statePath);
}

function safePersistActiveChatState(): void {
  try {
    persistActiveChatState();
  } catch {
    // Chat should keep working even when runtime state cannot be written.
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function listActiveChatsFromState(
  statePath = resolveActiveChatStatePath(),
  options: { includeDeadProcesses?: boolean } = {}
): ActiveChatSummary[] {
  if (!existsSync(statePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<ActiveChatStateFile>;
    const chats = Array.isArray(parsed.chats) ? parsed.chats : [];
    return chats.filter((chat): chat is ActiveChatSummary => {
      if (!chat || typeof chat !== "object") return false;
      if (typeof chat.id !== "string" || typeof chat.channel_id !== "string") return false;
      if (typeof chat.user_id !== "string" || typeof chat.prompt !== "string") return false;
      if (typeof chat.started_at !== "string" || typeof chat.pid !== "number") return false;
      return options.includeDeadProcesses || isProcessAlive(chat.pid);
    });
  } catch {
    return [];
  }
}

export function beginActiveChat(input: {
  channelId: string;
  userId: string;
  prompt: string;
}): ActiveChatHandle {
  const id = randomUUID();
  const controller = new AbortController();
  const summary: ActiveChatSummary = {
    id,
    channel_id: input.channelId,
    user_id: input.userId,
    prompt: input.prompt.replace(/\s+/g, " ").trim().slice(0, 500),
    started_at: new Date().toISOString(),
    pid: process.pid,
  };

  activeChats.set(id, { summary, controller });
  safePersistActiveChatState();

  return {
    id,
    signal: controller.signal,
    finish: () => finishActiveChat(id),
  };
}

export function finishActiveChat(chatId: string): void {
  if (!activeChats.delete(chatId)) return;
  safePersistActiveChatState();
  notifyActiveChatChange();
}

export function getActiveChatCount(): number {
  return activeChats.size;
}

export function listActiveChatIds(): string[] {
  return Array.from(activeChats.keys());
}

export async function waitForActiveChatsToDrain(timeoutMs: number): Promise<boolean> {
  if (activeChats.size === 0) return true;
  if (timeoutMs <= 0) return false;

  return await new Promise<boolean>((resolveResult) => {
    let settled = false;
    const finish = (drained: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      drainWaiters.delete(onDrain);
      resolveResult(drained);
    };
    const onDrain = () => {
      if (activeChats.size === 0) finish(true);
    };
    const timer = setTimeout(() => finish(activeChats.size === 0), timeoutMs);
    timer.unref?.();
    drainWaiters.add(onDrain);
  });
}

export function interruptActiveChats(reason: string): string[] {
  const ids = listActiveChatIds();
  for (const id of ids) {
    const entry = activeChats.get(id);
    if (!entry) continue;
    entry.controller.abort(new Error(reason));
    activeChats.delete(id);
  }
  safePersistActiveChatState();
  notifyActiveChatChange();
  return ids;
}

export function resetActiveChatRuntimeForTest(): void {
  activeChats.clear();
  drainWaiters.clear();
  safePersistActiveChatState();
}

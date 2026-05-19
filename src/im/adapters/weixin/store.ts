import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface WeixinAccountData {
  accountId: string;
  token: string;
  baseUrl?: string;
  userId?: string;
  savedAt?: string;
  getUpdatesBuf?: string;
  contextTokens?: Record<string, string>;
}

export const DEFAULT_WEIXIN_STATE_DIR = "~/.miniclaw/weixin";

export function resolveWeixinStateDir(stateDir = DEFAULT_WEIXIN_STATE_DIR): string {
  if (stateDir === "~") return homedir();
  if (stateDir.startsWith("~/")) return join(homedir(), stateDir.slice(2));
  return stateDir;
}

function indexPath(stateDir?: string): string {
  return join(resolveWeixinStateDir(stateDir), "accounts.json");
}

function accountPath(accountId: string, stateDir?: string): string {
  return join(resolveWeixinStateDir(stateDir), "accounts", `${accountId}.json`);
}

function readJson<T>(path: string): T | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
  try {
    if (path.endsWith(".json")) {
      // Account files may contain bot tokens. Keep permissions narrow on POSIX hosts.
      chmodSync(path, 0o600);
    }
  } catch {
    // Best effort only; Windows and some mounted filesystems may not support chmod.
  }
}

export function listWeixinAccountIds(stateDir?: string): string[] {
  const parsed = readJson<unknown>(indexPath(stateDir));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

export function loadWeixinAccount(accountId: string, stateDir?: string): WeixinAccountData | undefined {
  const data = readJson<WeixinAccountData>(accountPath(accountId, stateDir));
  if (!data?.token?.trim()) return undefined;
  return { ...data, accountId: data.accountId || accountId };
}

export function listWeixinAccounts(stateDir?: string): WeixinAccountData[] {
  return listWeixinAccountIds(stateDir)
    .map((id) => loadWeixinAccount(id, stateDir))
    .filter((account): account is WeixinAccountData => Boolean(account));
}

export function recentWeixinBotTokens(stateDir?: string, limit = 10): string[] {
  const ids = listWeixinAccountIds(stateDir).slice(-limit).reverse();
  const tokens: string[] = [];
  for (const id of ids) {
    const token = loadWeixinAccount(id, stateDir)?.token?.trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

export function saveWeixinAccount(
  accountId: string,
  update: Omit<Partial<WeixinAccountData>, "accountId">,
  stateDir?: string,
): WeixinAccountData {
  const existing = loadWeixinAccount(accountId, stateDir) ?? { accountId, token: "" };
  const next: WeixinAccountData = {
    ...existing,
    ...update,
    accountId,
    token: update.token?.trim() || existing.token,
    savedAt: update.savedAt ?? new Date().toISOString(),
  };
  writeJson(accountPath(accountId, stateDir), next);

  const ids = listWeixinAccountIds(stateDir);
  if (!ids.includes(accountId)) writeJson(indexPath(stateDir), [...ids, accountId]);
  return next;
}

export function clearWeixinAccount(accountId: string, stateDir?: string): void {
  try {
    unlinkSync(accountPath(accountId, stateDir));
  } catch {
    // Missing account files are fine.
  }
  const ids = listWeixinAccountIds(stateDir).filter((id) => id !== accountId);
  writeJson(indexPath(stateDir), ids);
}

export function clearStaleWeixinAccountsForUserId(currentAccountId: string, userId: string | undefined, stateDir?: string): void {
  const cleanUserId = userId?.trim();
  if (!cleanUserId) return;
  for (const account of listWeixinAccounts(stateDir)) {
    if (account.accountId !== currentAccountId && account.userId?.trim() === cleanUserId) {
      clearWeixinAccount(account.accountId, stateDir);
    }
  }
}

export function resolveWeixinAccount(accountId?: string, stateDir?: string): WeixinAccountData {
  if (accountId) {
    const account = loadWeixinAccount(accountId, stateDir);
    if (!account) throw new Error(`Weixin account '${accountId}' is not logged in`);
    return account;
  }
  const accounts = listWeixinAccounts(stateDir);
  if (accounts.length === 1) return accounts[0];
  if (!accounts.length) throw new Error("Weixin is not logged in; run `pnpm weixin:login` first");
  throw new Error("Multiple Weixin accounts are logged in; configure account_id for this target");
}

export function saveWeixinGetUpdatesBuf(accountId: string, getUpdatesBuf: string, stateDir?: string): void {
  const account = resolveWeixinAccount(accountId, stateDir);
  saveWeixinAccount(accountId, { ...account, getUpdatesBuf }, stateDir);
}

export function getWeixinContextToken(accountId: string, userId: string, stateDir?: string): string | undefined {
  return loadWeixinAccount(accountId, stateDir)?.contextTokens?.[userId];
}

export function saveWeixinContextToken(accountId: string, userId: string, contextToken: string, stateDir?: string): void {
  const account = resolveWeixinAccount(accountId, stateDir);
  saveWeixinAccount(accountId, {
    ...account,
    contextTokens: {
      ...(account.contextTokens ?? {}),
      [userId]: contextToken,
    },
  }, stateDir);
}

export function clearWeixinContextToken(accountId: string, userId: string, stateDir?: string): void {
  const account = loadWeixinAccount(accountId, stateDir);
  if (!account?.contextTokens?.[userId]) return;
  const nextTokens = { ...account.contextTokens };
  delete nextTokens[userId];
  saveWeixinAccount(accountId, {
    ...account,
    contextTokens: Object.keys(nextTokens).length ? nextTokens : undefined,
  }, stateDir);
}

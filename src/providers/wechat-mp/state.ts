import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveHome } from "./auth.js";
import type { WechatMpArticle, WechatMpFakeidCacheEntry, WechatMpSentArticleEntry, WechatMpState } from "./types.js";

function emptyState(): WechatMpState {
  return { updated_at: new Date().toISOString(), fakeids: {}, sent_articles: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function loadWechatMpState(path: string): WechatMpState {
  const resolved = resolveHome(path);
  if (!existsSync(resolved)) return emptyState();
  try {
    const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
    if (!isPlainObject(raw)) return emptyState();
    return {
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString(),
      fakeids: isPlainObject(raw.fakeids) ? raw.fakeids as Record<string, WechatMpFakeidCacheEntry> : {},
      sent_articles: isPlainObject(raw.sent_articles) ? raw.sent_articles as Record<string, WechatMpSentArticleEntry> : {},
    };
  } catch {
    return emptyState();
  }
}

export function saveWechatMpState(path: string, state: WechatMpState): void {
  const resolved = resolveHome(path);
  mkdirSync(dirname(resolved), { recursive: true });
  state.updated_at = new Date().toISOString();
  const tmp = `${resolved}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, resolved);
}

export function cacheFakeid(state: WechatMpState, key: string, entry: Omit<WechatMpFakeidCacheEntry, "updated_at">): void {
  state.fakeids[key] = { ...entry, updated_at: new Date().toISOString() };
}

export function markArticlesSent(state: WechatMpState, articles: WechatMpArticle[]): void {
  const sentAt = new Date().toISOString();
  for (const article of articles) {
    state.sent_articles[article.id] = {
      account: article.account,
      title: article.title,
      link: article.link,
      publish_time: article.publish_time,
      sent_at: sentAt,
    };
  }
}

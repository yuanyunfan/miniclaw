import { articleId, preferBizMatch } from "./parser.js";
import { cacheFakeid, loadWechatMpState, markArticlesSent, saveWechatMpState } from "./state.js";
import type {
  WechatMpAccountConfig,
  WechatMpArticle,
  WechatMpClient,
  WechatMpCollectResult,
  WechatMpProviderConfig,
  WechatMpState,
} from "./types.js";
import { sanitizeWechatMpError } from "./errors.js";

export interface CollectWechatMpOptions {
  now?: Date;
  state?: WechatMpState;
}

export interface CollectedWechatMpProviderData {
  result: WechatMpCollectResult;
  commit: () => Promise<void>;
}

export interface CollectionWindow {
  start: number;
  end: number;
  label?: string;
}

async function resolveFakeid(
  account: WechatMpAccountConfig,
  state: WechatMpState,
  client: WechatMpClient,
): Promise<{ fakeid: string; alias?: string }> {
  if (account.fakeid) return { fakeid: account.fakeid, alias: account.alias };
  const cached = state.fakeids[account.name];
  if (cached?.fakeid) return { fakeid: cached.fakeid, alias: cached.alias ?? account.alias };

  const candidates = await client.searchBiz(account.query);
  const match = preferBizMatch(candidates, account);
  if (!match) throw new Error(`no matching biz found for ${account.name}`);
  cacheFakeid(state, account.name, {
    fakeid: match.fakeid,
    nickname: match.nickname,
    alias: match.alias ?? account.alias,
  });
  return { fakeid: match.fakeid, alias: match.alias ?? account.alias };
}

function mergeArticles(account: WechatMpAccountConfig, alias: string | undefined, articles: Omit<WechatMpArticle, "id" | "account" | "account_alias">[]): WechatMpArticle[] {
  const seen = new Set<string>();
  const merged: WechatMpArticle[] = [];
  for (const article of articles) {
    const id = articleId(account.name, article.title, article.publish_time, article.link);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({
      ...article,
      id,
      account: account.name,
      account_alias: alias,
    });
  }
  return merged.sort((a, b) => b.publish_time - a.publish_time);
}

function localDateParts(date: Date, offsetHours: number): { year: number; month: number; day: number; hour: number } {
  const local = new Date(date.getTime() + offsetHours * 3600_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
  };
}

function localSlotToUtcSeconds(
  base: { year: number; month: number; day: number },
  dayOffset: number,
  hour: number,
  offsetHours: number,
): number {
  const localMs = Date.UTC(base.year, base.month, base.day + dayOffset, hour, 0, 0, 0);
  return Math.floor((localMs - offsetHours * 3600_000) / 1000);
}

function formatLocalWindowLabel(start: number, end: number, offsetHours: number): string {
  const fmt = (timestamp: number) => {
    const local = new Date(timestamp * 1000 + offsetHours * 3600_000);
    const y = local.getUTCFullYear();
    const m = String(local.getUTCMonth() + 1).padStart(2, "0");
    const d = String(local.getUTCDate()).padStart(2, "0");
    const h = String(local.getUTCHours()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:00`;
  };
  return `${fmt(start)} - ${fmt(end)} UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
}

export function resolveCollectionWindow(config: WechatMpProviderConfig, now: Date): CollectionWindow {
  const windowConfig = config.window ?? { mode: "relative" as const, hours: config.window_hours };
  if (windowConfig.mode === "relative") {
    const end = Math.floor(now.getTime() / 1000);
    return { start: end - windowConfig.hours * 3600, end };
  }

  const offset = windowConfig.timezone_offset_hours;
  const parts = localDateParts(now, offset);
  const sorted = [...windowConfig.slots].sort((a, b) => a.at_hour - b.at_hour);
  let baseDayOffset = 0;
  let slot = [...sorted].reverse().find((candidate) => parts.hour >= candidate.at_hour);
  if (!slot) {
    slot = sorted[sorted.length - 1];
    baseDayOffset = -1;
  }
  const base = { year: parts.year, month: parts.month, day: parts.day + baseDayOffset };
  const start = localSlotToUtcSeconds(base, slot.start_day_offset, slot.start_hour, offset);
  const end = localSlotToUtcSeconds(base, slot.end_day_offset, slot.end_hour, offset);
  if (start >= end) throw new Error("wechat-mp fixed slot window start must be before end");
  return { start, end, label: formatLocalWindowLabel(start, end, offset) };
}

async function fetchAccountArticles(
  account: WechatMpAccountConfig,
  fakeid: string,
  alias: string | undefined,
  config: WechatMpProviderConfig,
  client: WechatMpClient,
): Promise<WechatMpArticle[]> {
  const raw: Omit<WechatMpArticle, "id" | "account" | "account_alias">[] = [];
  for (let page = 0; page < config.max_pages_per_account; page++) {
    const begin = page * config.page_size;
    const published = await client.listPublishedArticles(fakeid, begin, config.page_size);
    raw.push(...published);
    if (published.length < config.page_size) break;
  }
  if (!raw.length) {
    for (let page = 0; page < config.max_pages_per_account; page++) {
      const begin = page * config.page_size;
      const fallback = await client.listAppMessages(fakeid, begin, config.page_size);
      raw.push(...fallback);
      if (fallback.length < config.page_size) break;
    }
  }
  return mergeArticles(account, alias, raw);
}

export async function collectWechatMpArticles(
  config: WechatMpProviderConfig,
  client: WechatMpClient,
  options: CollectWechatMpOptions = {},
): Promise<CollectedWechatMpProviderData> {
  const now = options.now ?? new Date();
  const state = options.state ?? loadWechatMpState(config.state_path);
  const window = resolveCollectionWindow(config, now);
  const collectedForCommit: WechatMpArticle[] = [];
  let skippedDuplicates = 0;

  const accounts: WechatMpCollectResult["accounts"] = [];
  for (const account of config.accounts) {
    try {
      const { fakeid, alias } = await resolveFakeid(account, state, client);
      const fetched = await fetchAccountArticles(account, fakeid, alias, config, client);
      const inWindow = fetched.filter((article) => article.publish_time >= window.start && article.publish_time < window.end);
      const deduped = config.dedupe
        ? inWindow.filter((article) => {
          if (state.sent_articles[article.id]) {
            skippedDuplicates++;
            return false;
          }
          return true;
        })
        : inWindow;
      collectedForCommit.push(...deduped);
      accounts.push({
        name: account.name,
        alias,
        status: "ok",
        article_count: deduped.length,
        articles: deduped,
      });
    } catch (err) {
      accounts.push({
        name: account.name,
        alias: account.alias,
        status: "error",
        article_count: 0,
        error: sanitizeWechatMpError(err),
        articles: [],
      });
    }
  }

  const result: WechatMpCollectResult = {
    generated_at: now.toISOString(),
    window_start: new Date(window.start * 1000).toISOString(),
    window_end: new Date(window.end * 1000).toISOString(),
    window_label: window.label,
    accounts,
    total_articles: accounts.reduce((sum, account) => sum + account.article_count, 0),
    skipped_duplicates: skippedDuplicates,
  };

  return {
    result,
    commit: async () => {
      markArticlesSent(state, collectedForCommit);
      saveWechatMpState(config.state_path, state);
    },
  };
}

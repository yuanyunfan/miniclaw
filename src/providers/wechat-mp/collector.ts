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
  const windowEnd = Math.floor(now.getTime() / 1000);
  const windowStart = windowEnd - config.window_hours * 3600;
  const collectedForCommit: WechatMpArticle[] = [];
  let skippedDuplicates = 0;

  const accounts: WechatMpCollectResult["accounts"] = [];
  for (const account of config.accounts) {
    try {
      const { fakeid, alias } = await resolveFakeid(account, state, client);
      const fetched = await fetchAccountArticles(account, fakeid, alias, config, client);
      const inWindow = fetched.filter((article) => article.publish_time >= windowStart && article.publish_time <= windowEnd);
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
    window_start: new Date(windowStart * 1000).toISOString(),
    window_end: new Date(windowEnd * 1000).toISOString(),
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

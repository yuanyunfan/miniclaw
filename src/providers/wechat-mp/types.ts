export interface WechatMpCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
}

export interface WechatMpSession {
  token: string;
  cookies: WechatMpCookie[];
  saved_at?: string;
  source_url?: string;
}

export interface WechatMpAccountConfig {
  name: string;
  query: string;
  alias?: string;
  fakeid?: string;
}

export interface WechatMpProviderConfig {
  auth_path: string;
  state_path: string;
  window_hours: number;
  max_pages_per_account: number;
  page_size: number;
  dedupe: boolean;
  accounts: WechatMpAccountConfig[];
}

export interface WechatMpFakeidCacheEntry {
  fakeid: string;
  nickname?: string;
  alias?: string;
  updated_at: string;
}

export interface WechatMpSentArticleEntry {
  account: string;
  title: string;
  link?: string;
  publish_time?: number;
  sent_at: string;
}

export interface WechatMpState {
  updated_at: string;
  fakeids: Record<string, WechatMpFakeidCacheEntry>;
  sent_articles: Record<string, WechatMpSentArticleEntry>;
}

export interface WechatMpBiz {
  fakeid: string;
  nickname?: string;
  alias?: string;
}

export interface WechatMpArticle {
  id: string;
  account: string;
  account_alias?: string;
  title: string;
  digest?: string;
  link?: string;
  cover?: string;
  publish_time: number;
  publish_time_iso: string;
  source: "appmsgpublish" | "appmsg";
}

export interface WechatMpCollectResult {
  generated_at: string;
  window_start: string;
  window_end: string;
  accounts: Array<{
    name: string;
    alias?: string;
    status: "ok" | "error";
    article_count: number;
    error?: string;
    articles: WechatMpArticle[];
  }>;
  total_articles: number;
  skipped_duplicates: number;
}

export interface WechatMpClient {
  searchBiz(query: string): Promise<WechatMpBiz[]>;
  listPublishedArticles(fakeid: string, begin: number, count: number): Promise<Omit<WechatMpArticle, "id" | "account" | "account_alias">[]>;
  listAppMessages(fakeid: string, begin: number, count: number): Promise<Omit<WechatMpArticle, "id" | "account" | "account_alias">[]>;
}

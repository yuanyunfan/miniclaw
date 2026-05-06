import type { WechatMpArticle, WechatMpBiz } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberField(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return normalizeTimestamp(value);
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return normalizeTimestamp(n);
    }
  }
  return undefined;
}

export function normalizeTimestamp(value: number): number {
  if (value > 10_000_000_000) return Math.floor(value / 1000);
  return Math.floor(value);
}

export function toIso(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

export function articleId(account: string, title: string, publishTime: number, link?: string): string {
  if (link) return link;
  return `${account}:${publishTime}:${title}`;
}

export function parseSearchBiz(payload: unknown): WechatMpBiz[] {
  const obj = asRecord(payload);
  if (!obj) return [];
  return asArray(obj.list)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      fakeid: stringField(item, ["fakeid"]) ?? "",
      nickname: stringField(item, ["nickname", "nick_name"]),
      alias: stringField(item, ["alias", "username"]),
    }))
    .filter((biz) => biz.fakeid);
}

function parseArticleItem(item: Record<string, unknown>, source: WechatMpArticle["source"]): Omit<WechatMpArticle, "id" | "account" | "account_alias"> | null {
  const title = stringField(item, ["title", "appmsg_title"]);
  if (!title) return null;
  const publishTime = numberField(item, ["update_time", "create_time", "publish_time", "sent_time"]);
  if (!publishTime) return null;
  return {
    title,
    digest: stringField(item, ["digest", "appmsg_digest"]),
    link: stringField(item, ["link", "content_url"]),
    cover: stringField(item, ["cover", "cover_url"]),
    publish_time: publishTime,
    publish_time_iso: toIso(publishTime),
    source,
  };
}

export function parseAppmsg(payload: unknown): Omit<WechatMpArticle, "id" | "account" | "account_alias">[] {
  const obj = asRecord(payload);
  if (!obj) return [];
  return asArray(obj.app_msg_list)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => parseArticleItem(item, "appmsg"))
    .filter((item): item is Omit<WechatMpArticle, "id" | "account" | "account_alias"> => Boolean(item));
}

export function parseAppmsgPublish(payload: unknown): Omit<WechatMpArticle, "id" | "account" | "account_alias">[] {
  const obj = asRecord(payload);
  if (!obj) return [];
  const page = parseMaybeJsonObject(obj.publish_page);
  const publishList = asArray(page?.publish_list);
  const articleItems: Record<string, unknown>[] = [];

  for (const rawPublish of publishList) {
    const publish = asRecord(rawPublish);
    if (!publish) continue;
    const info = parseMaybeJsonObject(publish.publish_info);
    const appmsgex = asArray(info?.appmsgex);
    for (const rawArticle of appmsgex) {
      const article = asRecord(rawArticle);
      if (article) articleItems.push(article);
    }
  }

  return articleItems
    .map((item) => parseArticleItem(item, "appmsgpublish"))
    .filter((item): item is Omit<WechatMpArticle, "id" | "account" | "account_alias"> => Boolean(item));
}

export function preferBizMatch(list: WechatMpBiz[], account: { name: string; alias?: string }): WechatMpBiz | undefined {
  if (!list.length) return undefined;
  if (account.alias) {
    const byAlias = list.find((biz) => biz.alias === account.alias);
    if (byAlias) return byAlias;
  }
  return list.find((biz) => biz.nickname === account.name) ?? list[0];
}

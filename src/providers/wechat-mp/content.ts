import type { WechatMpArticle, WechatMpContentFetchResult, WechatMpReadFilterConfig, WechatMpSession } from "./types.js";
import { sanitizeWechatMpError } from "./errors.js";
import { buildCookieHeader } from "./auth.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const ARTICLE_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const WECHAT_MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48 NetType/WIFI Language/zh_CN";
const BLOCK_TAGS = /<\/?(?:p|div|section|article|blockquote|h[1-6]|li|ul|ol|br|tr|td|th|table)[^>]*>/gi;
const SELF_CLOSING = /\/\s*>$/;

export interface FetchWechatMpArticleContentOptions {
  now: Date;
  config: WechatMpReadFilterConfig;
  fetchImpl?: FetchLike;
  cookieHeader?: string;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function findOpeningTagStart(html: string, idIndex: number): number {
  const start = html.lastIndexOf("<", idIndex);
  return start >= 0 ? start : -1;
}

export function extractElementById(html: string, id: string): string | undefined {
  const idPattern = new RegExp(`\\bid=[\"']${id}[\"']`, "i");
  const match = idPattern.exec(html);
  if (match?.index === undefined) return undefined;

  const openStart = findOpeningTagStart(html, match.index);
  if (openStart < 0) return undefined;
  const openEnd = html.indexOf(">", openStart);
  if (openEnd < 0) return undefined;

  const openTag = html.slice(openStart, openEnd + 1);
  const tagName = /^<\s*([a-z0-9:-]+)/i.exec(openTag)?.[1]?.toLowerCase();
  if (!tagName) return undefined;

  const tagPattern = new RegExp(`<\\/?\\s*${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = openStart;
  let depth = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const tag = tagMatch[0];
    const isClosing = /^<\s*\//.test(tag);
    const isSelfClosing = SELF_CLOSING.test(tag);
    if (isClosing) {
      depth--;
      if (depth === 0) return html.slice(openEnd + 1, tagMatch.index);
    } else if (!isSelfClosing) {
      depth++;
    }
  }
  return undefined;
}

export function htmlToWechatArticleText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n"))
    .trim();
}

export function extractWechatArticleText(html: string): string | undefined {
  const content = extractElementById(html, "js_content");
  if (!content) return undefined;
  const text = htmlToWechatArticleText(content);
  return text.length >= 80 ? text : undefined;
}

function makeExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n...`;
}

export async function fetchWechatMpArticleContent(
  article: Pick<WechatMpArticle, "link">,
  options: FetchWechatMpArticleContentOptions,
): Promise<WechatMpContentFetchResult> {
  if (!article.link) return { status: "failed", error: "article has no link" };
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError = "";
  for (const userAgent of [ARTICLE_USER_AGENT, WECHAT_MOBILE_USER_AGENT]) {
    const headers: Record<string, string> = {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://mp.weixin.qq.com/",
    };
    if (options.cookieHeader) headers.Cookie = options.cookieHeader;

    try {
      const res = await fetchImpl(article.link, {
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(options.config.fetch_timeout_ms),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const html = await res.text();
      const text = extractWechatArticleText(html);
      if (!text) {
        lastError = "js_content not found or article text too short";
        continue;
      }
      return {
        status: "ok",
        fetched_at: options.now.toISOString(),
        text_chars: text.length,
        excerpt: makeExcerpt(text, options.config.excerpt_chars),
      };
    } catch (err) {
      lastError = sanitizeWechatMpError(err);
    }
  }
  return { status: "failed", error: lastError || "article fetch failed" };
}

export function createWechatMpArticleContentFetcher(session: WechatMpSession) {
  const cookieHeader = buildCookieHeader(session.cookies);
  return (
    article: WechatMpArticle,
    options: { now: Date; config: WechatMpReadFilterConfig },
  ): Promise<WechatMpContentFetchResult> => fetchWechatMpArticleContent(article, {
    ...options,
    cookieHeader,
  });
}

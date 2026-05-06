import { buildCookieHeader } from "./auth.js";
import { assertWechatRet } from "./errors.js";
import { parseAppmsg, parseAppmsgPublish, parseSearchBiz } from "./parser.js";
import type { WechatMpArticle, WechatMpBiz, WechatMpClient, WechatMpSession } from "./types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://mp.weixin.qq.com";

export class HttpWechatMpClient implements WechatMpClient {
  private readonly cookieHeader: string;

  constructor(
    private readonly session: WechatMpSession,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.cookieHeader = buildCookieHeader(session.cookies);
  }

  async searchBiz(query: string): Promise<WechatMpBiz[]> {
    const payload = await this.requestJson("/cgi-bin/searchbiz", {
      action: "search_biz",
      begin: "0",
      count: "5",
      query,
      token: this.session.token,
      lang: "zh_CN",
      f: "json",
      ajax: "1",
    }, "searchbiz");
    return parseSearchBiz(payload);
  }

  async listPublishedArticles(fakeid: string, begin: number, count: number): Promise<Omit<WechatMpArticle, "id" | "account" | "account_alias">[]> {
    const payload = await this.requestJson("/cgi-bin/appmsgpublish", {
      sub: "list",
      sub_action: "list_ex",
      search_field: "null",
      begin: String(begin),
      count: String(count),
      query: "",
      fakeid,
      type: "101_1",
      free_publish_type: "1",
      token: this.session.token,
      lang: "zh_CN",
      f: "json",
      ajax: "1",
    }, "appmsgpublish");
    return parseAppmsgPublish(payload);
  }

  async listAppMessages(fakeid: string, begin: number, count: number): Promise<Omit<WechatMpArticle, "id" | "account" | "account_alias">[]> {
    const payload = await this.requestJson("/cgi-bin/appmsg", {
      action: "list_ex",
      begin: String(begin),
      count: String(count),
      fakeid,
      type: "9",
      query: "",
      token: this.session.token,
      lang: "zh_CN",
      f: "json",
      ajax: "1",
    }, "appmsg");
    return parseAppmsg(payload);
  }

  private async requestJson(path: string, params: Record<string, string>, context: string): Promise<unknown> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const res = await this.fetchImpl(url, {
      headers: {
        Cookie: this.cookieHeader,
        Referer: `${BASE_URL}/`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
        Accept: "application/json, text/plain, */*",
      },
    });
    if (!res.ok) throw new Error(`${context}: HTTP ${res.status}`);
    const payload = await res.json() as unknown;
    assertWechatRet(payload, context);
    return payload;
  }
}

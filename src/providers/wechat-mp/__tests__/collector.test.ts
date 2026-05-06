import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectWechatMpArticles, resolveCollectionWindow } from "../collector.js";
import type { WechatMpClient, WechatMpProviderConfig, WechatMpState } from "../types.js";

const NOW = new Date("2026-05-06T16:00:00.000Z");
const RECENT_TS = Math.floor(new Date("2026-05-06T13:36:40.000Z").getTime() / 1000);
const OLD_TS = Math.floor(new Date("2026-05-04T16:00:00.000Z").getTime() / 1000);
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-wechat-collector-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function config(overrides: Partial<WechatMpProviderConfig> = {}): WechatMpProviderConfig {
  return {
    auth_path: "unused",
    state_path: join(tmp, "state.json"),
    window_hours: 24,
    max_pages_per_account: 1,
    page_size: 10,
    dedupe: true,
    accounts: [{ name: "机器之心", query: "机器之心", alias: "almosthuman2014" }],
    ...overrides,
  };
}

function state(): WechatMpState {
  return { updated_at: "2026-05-06T00:00:00.000Z", fakeids: {}, sent_articles: {} };
}

function fixedSlotWindow(): WechatMpProviderConfig["window"] {
  return {
    mode: "fixed_slots",
    timezone_offset_hours: 8,
    slots: [
      {
        at_hour: 10,
        start_day_offset: -1,
        start_hour: 17,
        end_day_offset: 0,
        end_hour: 10,
      },
      {
        at_hour: 17,
        start_day_offset: 0,
        start_hour: 10,
        end_day_offset: 0,
        end_hour: 17,
      },
    ],
  };
}

describe("resolveCollectionWindow", () => {
  it("uses the 10:00 Beijing slot from yesterday 17:00 to today 10:00", () => {
    const window = resolveCollectionWindow(config({ window: fixedSlotWindow() }), new Date("2026-05-06T02:00:00.000Z"));

    expect(new Date(window.start * 1000).toISOString()).toBe("2026-05-05T09:00:00.000Z");
    expect(new Date(window.end * 1000).toISOString()).toBe("2026-05-06T02:00:00.000Z");
    expect(window.label).toBe("2026-05-05 17:00 - 2026-05-06 10:00 UTC+8");
  });

  it("uses the 17:00 Beijing slot from today 10:00 to today 17:00", () => {
    const window = resolveCollectionWindow(config({ window: fixedSlotWindow() }), new Date("2026-05-06T09:00:00.000Z"));

    expect(new Date(window.start * 1000).toISOString()).toBe("2026-05-06T02:00:00.000Z");
    expect(new Date(window.end * 1000).toISOString()).toBe("2026-05-06T09:00:00.000Z");
  });

  it("uses the previous day's 17:00 slot before the first Beijing trigger", () => {
    const window = resolveCollectionWindow(config({ window: fixedSlotWindow() }), new Date("2026-05-06T01:00:00.000Z"));

    expect(new Date(window.start * 1000).toISOString()).toBe("2026-05-05T02:00:00.000Z");
    expect(new Date(window.end * 1000).toISOString()).toBe("2026-05-05T09:00:00.000Z");
  });
});

describe("collectWechatMpArticles", () => {
  it("searches fakeid, filters by 24h window and commits sent articles", async () => {
    const st = state();
    const client: WechatMpClient = {
      searchBiz: async () => [{ fakeid: "fake-1", nickname: "机器之心", alias: "almosthuman2014" }],
      listPublishedArticles: async () => [
        { title: "新文章", publish_time: RECENT_TS, publish_time_iso: "2026-05-06T13:36:40.000Z", link: "https://mp.weixin.qq.com/s/new", source: "appmsgpublish" },
        { title: "旧文章", publish_time: OLD_TS, publish_time_iso: "2026-05-04T16:00:00.000Z", link: "https://mp.weixin.qq.com/s/old", source: "appmsgpublish" },
      ],
      listAppMessages: async () => [],
    };

    const collected = await collectWechatMpArticles(config(), client, {
      now: NOW,
      state: st,
    });

    expect(collected.result.total_articles).toBe(1);
    expect(collected.result.accounts[0].articles[0].title).toBe("新文章");
    expect(st.fakeids["机器之心"].fakeid).toBe("fake-1");

    await collected.commit();
    expect(st.sent_articles["https://mp.weixin.qq.com/s/new"].title).toBe("新文章");
  });

  it("deduplicates articles already in state", async () => {
    const st = state();
    st.fakeids["机器之心"] = { fakeid: "fake-1", updated_at: "2026-05-06T00:00:00.000Z" };
    st.sent_articles["https://mp.weixin.qq.com/s/new"] = {
      account: "机器之心",
      title: "新文章",
      link: "https://mp.weixin.qq.com/s/new",
      publish_time: RECENT_TS,
      sent_at: "2026-05-06T00:00:00.000Z",
    };

    const client: WechatMpClient = {
      searchBiz: async () => { throw new Error("should use cache"); },
      listPublishedArticles: async () => [
        { title: "新文章", publish_time: RECENT_TS, publish_time_iso: "2026-05-06T13:36:40.000Z", link: "https://mp.weixin.qq.com/s/new", source: "appmsgpublish" },
      ],
      listAppMessages: async () => [],
    };

    const collected = await collectWechatMpArticles(config(), client, {
      now: NOW,
      state: st,
    });

    expect(collected.result.total_articles).toBe(0);
    expect(collected.result.skipped_duplicates).toBe(1);
  });

  it("falls back to appmsg when appmsgpublish returns empty", async () => {
    const st = state();
    const client: WechatMpClient = {
      searchBiz: async () => [{ fakeid: "fake-1", nickname: "机器之心" }],
      listPublishedArticles: async () => [],
      listAppMessages: async () => [
        { title: "fallback", publish_time: RECENT_TS, publish_time_iso: "2026-05-06T13:36:40.000Z", link: "https://mp.weixin.qq.com/s/fallback", source: "appmsg" },
      ],
    };

    const collected = await collectWechatMpArticles(config(), client, {
      now: NOW,
      state: st,
    });

    expect(collected.result.accounts[0].articles[0].source).toBe("appmsg");
  });

  it("filters with fixed slot boundaries and deduplicates sent articles", async () => {
    const st = state();
    st.fakeids["机器之心"] = { fakeid: "fake-1", updated_at: "2026-05-06T00:00:00.000Z" };
    st.sent_articles["https://mp.weixin.qq.com/s/sent"] = {
      account: "机器之心",
      title: "已发送",
      link: "https://mp.weixin.qq.com/s/sent",
      publish_time: Math.floor(new Date("2026-05-06T03:00:00.000Z").getTime() / 1000),
      sent_at: "2026-05-06T09:00:00.000Z",
    };

    const client: WechatMpClient = {
      searchBiz: async () => { throw new Error("should use cache"); },
      listPublishedArticles: async () => [
        {
          title: "早间边界",
          publish_time: Math.floor(new Date("2026-05-06T02:00:00.000Z").getTime() / 1000),
          publish_time_iso: "2026-05-06T02:00:00.000Z",
          link: "https://mp.weixin.qq.com/s/start",
          source: "appmsgpublish",
        },
        {
          title: "已发送",
          publish_time: Math.floor(new Date("2026-05-06T03:00:00.000Z").getTime() / 1000),
          publish_time_iso: "2026-05-06T03:00:00.000Z",
          link: "https://mp.weixin.qq.com/s/sent",
          source: "appmsgpublish",
        },
        {
          title: "晚间边界",
          publish_time: Math.floor(new Date("2026-05-06T09:00:00.000Z").getTime() / 1000),
          publish_time_iso: "2026-05-06T09:00:00.000Z",
          link: "https://mp.weixin.qq.com/s/end",
          source: "appmsgpublish",
        },
        {
          title: "过早",
          publish_time: Math.floor(new Date("2026-05-06T01:59:59.000Z").getTime() / 1000),
          publish_time_iso: "2026-05-06T01:59:59.000Z",
          link: "https://mp.weixin.qq.com/s/before",
          source: "appmsgpublish",
        },
      ],
      listAppMessages: async () => [],
    };

    const collected = await collectWechatMpArticles(config({ window: fixedSlotWindow() }), client, {
      now: new Date("2026-05-06T09:00:00.000Z"),
      state: st,
    });

    expect(collected.result.total_articles).toBe(1);
    expect(collected.result.skipped_duplicates).toBe(1);
    expect(collected.result.accounts[0].articles.map((article) => article.title)).toEqual(["早间边界"]);
    expect(collected.result.window_label).toBe("2026-05-06 10:00 - 2026-05-06 17:00 UTC+8");
  });
});

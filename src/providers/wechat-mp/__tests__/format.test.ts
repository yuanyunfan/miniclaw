import { describe, expect, it } from "vitest";
import { formatWechatMpCollectResult } from "../format.js";

describe("formatWechatMpCollectResult", () => {
  it("outputs compact JSON without provider secrets", () => {
    const text = formatWechatMpCollectResult({
      generated_at: "2026-05-06T10:00:00.000Z",
      window_start: "2026-05-05T10:00:00.000Z",
      window_end: "2026-05-06T10:00:00.000Z",
      total_articles: 1,
      skipped_duplicates: 0,
      accounts: [{
        name: "阿里云开发者",
        status: "ok",
        article_count: 1,
        articles: [{
          id: "x",
          account: "阿里云开发者",
          title: "标题",
          digest: "摘要",
          link: "https://mp.weixin.qq.com/s/x",
          publish_time: 1_777_777_000,
          publish_time_iso: "2026-05-06T13:36:40.000Z",
          source: "appmsg",
        }],
      }],
    });

    expect(JSON.parse(text)).toMatchObject({ total_articles: 1 });
    expect(text).not.toMatch(/token|cookie|slave_sid|bizuin/i);
  });
});

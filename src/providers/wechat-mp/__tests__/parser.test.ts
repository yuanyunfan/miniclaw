import { describe, expect, it } from "vitest";
import { parseAppmsg, parseAppmsgPublish, parseSearchBiz } from "../parser.js";

describe("wechat-mp parser", () => {
  it("parses searchbiz results", () => {
    expect(parseSearchBiz({
      list: [
        { fakeid: "fake-1", nickname: "机器之心", alias: "almosthuman2014" },
        { nickname: "bad" },
      ],
    })).toEqual([
      { fakeid: "fake-1", nickname: "机器之心", alias: "almosthuman2014" },
    ]);
  });

  it("parses appmsg list results", () => {
    const articles = parseAppmsg({
      app_msg_list: [
        { title: "标题", digest: "摘要", link: "https://mp.weixin.qq.com/s/x", update_time: 1_777_777_777 },
      ],
    });

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      title: "标题",
      digest: "摘要",
      link: "https://mp.weixin.qq.com/s/x",
      source: "appmsg",
    });
  });

  it("parses appmsgpublish nested JSON strings", () => {
    const articles = parseAppmsgPublish({
      publish_page: JSON.stringify({
        publish_list: [
          {
            publish_info: JSON.stringify({
              appmsgex: [
                { title: "发布文章", digest: "发布摘要", link: "https://mp.weixin.qq.com/s/y", update_time: "1777777777" },
              ],
            }),
          },
        ],
      }),
    });

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      title: "发布文章",
      digest: "发布摘要",
      link: "https://mp.weixin.qq.com/s/y",
      source: "appmsgpublish",
    });
  });
});

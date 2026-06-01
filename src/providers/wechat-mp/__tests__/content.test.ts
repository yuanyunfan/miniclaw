import { describe, expect, it } from "vitest";
import { extractElementById, extractWechatArticleText, fetchWechatMpArticleContent, htmlToWechatArticleText } from "../content.js";

describe("wechat-mp content extraction", () => {
  it("extracts the js_content element with nested divs", () => {
    const html = `<html><body><div id="js_content"><p>第一段&nbsp;内容</p><div><p>第二段 <strong>加粗</strong></p></div></div><script>var x=1</script></body></html>`;

    expect(extractElementById(html, "js_content")).toContain("第二段");
    expect(htmlToWechatArticleText(extractElementById(html, "js_content") ?? "")).toBe("第一段 内容\n第二段 加粗");
  });

  it("rejects pages without enough article text", () => {
    expect(extractWechatArticleText("<html><body><div id=\"js_content\"><p>短</p></div></body></html>")).toBeUndefined();
  });

  it("fetches and truncates article excerpts with a browser-like request", async () => {
    const longText = "正文内容".repeat(80);
    const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "User-Agent": expect.stringContaining("Mozilla") });
      expect(init?.headers).toMatchObject({ Cookie: "slave_sid=sid" });
      return new Response(`<html><body><div id="js_content"><p>${longText}</p></div></body></html>`, { status: 200 });
    };

    const result = await fetchWechatMpArticleContent({ link: "https://mp.weixin.qq.com/s/example" }, {
      now: new Date("2026-05-26T00:00:00.000Z"),
      config: { enabled: true, min_title_score: 55, max_articles_to_fetch: 5, excerpt_chars: 60, fetch_timeout_ms: 1000 },
      fetchImpl,
      cookieHeader: "slave_sid=sid",
    });

    expect(result.status).toBe("ok");
    expect(result.text_chars).toBeGreaterThan(60);
    expect(result.excerpt).toMatch(/\.\.\.$/);
  });
});

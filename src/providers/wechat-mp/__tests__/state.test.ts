import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadWechatMpState, markArticlesSent, saveWechatMpState } from "../state.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-wechat-state-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("wechat-mp state", () => {
  it("returns empty state for missing or broken files", () => {
    expect(loadWechatMpState(join(tmp, "missing.json")).fakeids).toEqual({});
    const broken = join(tmp, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(loadWechatMpState(broken).sent_articles).toEqual({});
  });

  it("saves sent article state atomically", () => {
    const path = join(tmp, "state.json");
    const state = loadWechatMpState(path);
    markArticlesSent(state, [{
      id: "https://mp.weixin.qq.com/s/x",
      account: "机器之心",
      title: "标题",
      link: "https://mp.weixin.qq.com/s/x",
      publish_time: 1_777_777_000,
      publish_time_iso: "2026-05-06T13:36:40.000Z",
      source: "appmsg",
    }]);
    saveWechatMpState(path, state);

    const raw = JSON.parse(readFileSync(path, "utf8")) as { sent_articles: Record<string, { title: string }> };
    expect(raw.sent_articles["https://mp.weixin.qq.com/s/x"].title).toBe("标题");
  });
});

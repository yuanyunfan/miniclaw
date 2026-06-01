import { describe, expect, it } from "vitest";
import { screenWechatMpArticleTitle } from "../screening.js";

describe("screenWechatMpArticleTitle", () => {
  it("promotes engineering-heavy agent and data-platform articles", () => {
    const screen = screenWechatMpArticleTitle({
      account: "InfoQ",
      title: "大规模工程支撑场景下的多智能体系统设计：Grab 实践案例",
      digest: "数据团队搭建多智能体AI系统，自动化数据仓库平台重复工程运维工作。",
    });

    expect(screen.decision).toBe("full_read");
    expect(screen.score).toBeGreaterThanOrEqual(55);
    expect(screen.reasons.join(" ")).toMatch(/agent|数据平台|工程实践|来源/);
  });

  it("penalizes title-bait and unsupported leak claims", () => {
    const screen = screenWechatMpArticleTitle({
      account: "新智元",
      title: "GPT-5.6泄露了！",
      digest: "150万Token超级智能体，奥特曼掀翻硅谷",
    });

    expect(screen.decision).not.toBe("full_read");
    expect(screen.penalties.join(" ")).toContain("标题党措辞");
  });

  it("skips recruitment and event posts even when they mention AI", () => {
    const screen = screenWechatMpArticleTitle({
      account: "DataFunTalk",
      title: "AI招聘直播｜创始人亲自带岗，简历直推",
      digest: undefined,
    });

    expect(screen.decision).toBe("skip");
    expect(screen.penalties.join(" ")).toContain("活动/招聘/会议信息");
  });
});

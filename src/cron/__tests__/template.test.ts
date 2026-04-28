import { describe, it, expect } from "vitest";
import { renderTemplate } from "../template.js";

describe("renderTemplate", () => {
  it("内置变量 date / time / weekday 替换", () => {
    const out = renderTemplate("今天 {{date}} 是 {{weekday}}");
    expect(out).toMatch(/今天 \d{4}-\d{2}-\d{2} 是 周./);
  });

  it("自定义变量优先级高于内置同名", () => {
    expect(renderTemplate("{{date}}", { date: "OVERRIDE" })).toBe("OVERRIDE");
  });

  it("未知占位符保留原文", () => {
    expect(renderTemplate("{{unknown}} ok")).toBe("{{unknown}} ok");
  });

  it("点号变量名（cron.name）", () => {
    expect(renderTemplate("[{{cron.name}}]", { "cron.name": "morning" })).toBe("[morning]");
  });

  it("多变量混合 + 空格容忍", () => {
    expect(renderTemplate("{{ greeting }}, {{name}}!", { greeting: "你好", name: "yyf" }))
      .toBe("你好, yyf!");
  });

  it("空字符串模板 → 空字符串", () => {
    expect(renderTemplate("")).toBe("");
  });
});

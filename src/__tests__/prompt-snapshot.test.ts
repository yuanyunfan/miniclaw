import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { __testables as taskT } from "../agent/task.js";
import { __testables as chatT } from "../agent/chat.js";
import { __testables as extractT } from "../memory/extract.js";
import { __testables as stageT } from "../stage/stage-manager.js";
import { __testables as cronT } from "../cron/runner-task.js";
import { buildCronOutputContractBlock } from "../cron/output-contract.js";
import { config } from "../config.js";

function hash(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

describe("prompt snapshot baseline", () => {
  it("task.identityLine", () => {
    expect(hash(taskT.IDENTITY_LINE_TASK)).toMatchInlineSnapshot(`"1fb181714eee9324"`);
  });

  it("task.supervisorBlock (5 角色)", () => {
    const names = ["researcher", "code-investigator", "planner", "generator", "evaluator"];
    expect(hash(taskT.buildSupervisorBlock(names))).toMatchInlineSnapshot(`"20bdb3e2472cac7e"`);
  });

  it("task.supervisorBlock (空 names → 空字符串)", () => {
    expect(taskT.buildSupervisorBlock([])).toBe("");
  });

  it("chat.identityLine", () => {
    expect(hash(chatT.IDENTITY_LINE.replace(config.defaultCwd, "<cwd>"))).toMatchInlineSnapshot(`"0df4fb1a7cd054a8"`);
  });

  it("memory.extract.system", () => {
    expect(hash(extractT.EXTRACT_SYSTEM)).toMatchInlineSnapshot(`"a92ab53cf54ff87b"`);
  });

  it("memory.extract.user.fixture", () => {
    const out = extractT.buildExtractUserPrompt(
      "用户消息固定文本",
      "助手回复固定文本",
      "\n已有记忆:\n- [user] foo: bar",
    );
    expect(hash(out)).toMatchInlineSnapshot(`"3a32494fdab8a538"`);
  });

  it("stage.system", () => {
    expect(hash(stageT.SYSTEM_PROMPT)).toMatchInlineSnapshot(`"e792fa0e6bf436b3"`);
  });

  it("cron.preScriptBlock.fixture", () => {
    const out = cronT.buildCronPreScriptBlock("collect.py", "line1\nline2\nline3");
    expect(hash(out)).toMatchInlineSnapshot(`"02451e75cdc0769b"`);
  });

  it("cron.preProviderBlock.fixture", () => {
    const out = cronT.buildCronPreProviderBlock("wechat-mp", "{\"total_articles\":1}");
    expect(hash(out)).toMatchInlineSnapshot(`"df1692f85f93824e"`);
  });

  it("cron.preProviderBlock keeps structured provider context beyond script stdout cap", () => {
    const longJson = `{"source":"stock-portfolio","asset_summary":"${"x".repeat(9000)}"}`;
    const out = cronT.buildCronPreProviderBlock("stock-portfolio", longJson);
    expect(out).toContain("asset_summary");
    expect(out).toContain(`${longJson}\n\`\`\``);
  });

  it("cron.taskPrompt.fixture", () => {
    const out = cronT.buildCronTaskPrompt("morning-brief", "PRE_CTX\n\n", "do the thing");
    expect(hash(out)).toMatchInlineSnapshot(`"a822eed2bd677d6f"`);
  });

  it("cron.taskPrompt.outputContract.fixture", () => {
    const outputContract = buildCronOutputContractBlock({
      validator: "none",
      renderedTemplate: "## Summary\nReport first.",
    });
    const out = cronT.buildCronTaskPrompt("morning-brief", "", "do the thing", outputContract);
    expect(hash(out)).toMatchInlineSnapshot(`"e1afdd1080b9b4b3"`);
  });

  it("cron.skillPrompt.fixture (无 args)", () => {
    const out = cronT.buildCronSkillPrompt("nightly", "summarize", undefined);
    expect(hash(out)).toMatchInlineSnapshot(`"5c22c4f143113eff"`);
  });

  it("cron.skillPrompt.fixture (含 args)", () => {
    const out = cronT.buildCronSkillPrompt("weekly", "report", { period: "7d", verbose: true });
    expect(hash(out)).toMatchInlineSnapshot(`"5837d4864006b513"`);
  });
});

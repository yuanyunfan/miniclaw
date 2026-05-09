import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCronJobs } from "../loader.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-cron-"));
  process.env.MINICLAW_CRON_DIR = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.MINICLAW_CRON_DIR;
});

function write(file: string, body: string): void {
  writeFileSync(join(tmp, file), body);
}

// 测试用 channel ID 占位符（19 位数字符合 Discord snowflake 校验，但不指向任何真实频道）
const VALID_CHANNEL = "1000000000000000000";

describe("loadCronJobs", () => {
  it("空目录 → 空 jobs + 写入 .example.yaml", () => {
    const r = loadCronJobs();
    expect(r.jobs).toEqual([]);
    expect(r.errors).toEqual([]);
    // .example.yaml 是隐藏文件不会被加载（filter 规则）
  });

  it("解析有效 type=task", () => {
    write("daily-brief.yaml", `
name: daily-brief
schedule: "0 9 * * *"
enabled: true
type: task
channel: "${VALID_CHANNEL}"
prompt: "扫描 ~/Code 项目"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    const j = r.jobs[0];
    expect(j.type).toBe("task");
    expect(j.name).toBe("daily-brief");
    if (j.type === "task") {
      expect(j.prompt).toBe("扫描 ~/Code 项目");
    }
  });

  it("解析 type=task + pre_provider", () => {
    write("daily-wechat.yaml", `
name: daily-wechat
schedule: "0 10 * * *"
enabled: true
type: task
channel: "${VALID_CHANNEL}"
pre_provider: wechat-mp
pre_provider_config: daily-ai-wechat
prompt: "总结微信公众号更新"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    const j = r.jobs[0];
    expect(j.type).toBe("task");
    if (j.type === "task") {
      expect(j.pre_provider).toBe("wechat-mp");
      expect(j.pre_provider_config).toBe("daily-ai-wechat");
    }
  });

  it("解析同一 job 的多条 schedule", () => {
    write("market-pulse.yaml", `
name: market-pulse
schedule:
  - "30 21-23 * * 1-5"
  - "30 0 * * 2-6"
enabled: true
type: message
channel: "${VALID_CHANNEL}"
content: "pulse"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    expect(r.jobs[0].schedule).toEqual(["30 21-23 * * 1-5", "30 0 * * 2-6"]);
  });

  it("解析 type=message + 默认 enabled=true", () => {
    write("morning.yaml", `
name: morning
schedule: "0 9 * * *"
type: message
channel: "${VALID_CHANNEL}"
content: "早安 {{date}}"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs[0].enabled).toBe(true);
    if (r.jobs[0].type === "message") {
      expect(r.jobs[0].content).toBe("早安 {{date}}");
    }
  });

  it("解析 type=script", () => {
    write("backup.yaml", `
name: backup
schedule: "0 3 * * *"
type: script
channel: "${VALID_CHANNEL}"
script: backup-db.sh
args: ["--keep", "14"]
timeout_sec: 600
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    if (r.jobs[0].type === "script") {
      expect(r.jobs[0].script).toBe("backup-db.sh");
      expect(r.jobs[0].args).toEqual(["--keep", "14"]);
      expect(r.jobs[0].timeout_sec).toBe(600);
      expect(r.jobs[0].capture_output).toBe(true);
    }
  });

  it("解析 type=skill", () => {
    write("daily-cost.yaml", `
name: daily-cost
schedule: "0 23 * * *"
type: skill
channel: "${VALID_CHANNEL}"
skill: cost-report
skill_args:
  period: today
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    if (r.jobs[0].type === "skill") {
      expect(r.jobs[0].skill).toBe("cost-report");
      expect(r.jobs[0].skill_args).toEqual({ period: "today" });
    }
  });

  it("非法 cron 表达式 → 进 errors 不进 jobs", () => {
    write("bad.yaml", `
name: bad
schedule: "not a cron"
type: message
channel: "${VALID_CHANNEL}"
content: hi
`);
    const r = loadCronJobs();
    expect(r.jobs).toEqual([]);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].error).toMatch(/invalid cron schedule/);
  });

  it("非法 schedule 数组成员 → 进 errors 不进 jobs", () => {
    write("bad-array.yaml", `
name: bad-array
schedule:
  - "0 9 * * *"
  - "not a cron"
type: message
channel: "${VALID_CHANNEL}"
content: hi
`);
    const r = loadCronJobs();
    expect(r.jobs).toEqual([]);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].error).toMatch(/invalid cron schedule/);
  });

  it("缺 channel → error", () => {
    write("nochannel.yaml", `name: x\nschedule: "0 9 * * *"\ntype: message\ncontent: hi\n`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/channel/);
  });

  it("script 字段含路径分隔符 → 拒绝", () => {
    write("dangerous.yaml", `
name: x
schedule: "0 9 * * *"
type: script
channel: "${VALID_CHANNEL}"
script: ../../etc/passwd
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/路径分隔符/);
  });

  it("pre_script 和 pre_provider 同时配置 → 拒绝", () => {
    write("bad-pre.yaml", `
name: x
schedule: "0 9 * * *"
type: task
channel: "${VALID_CHANNEL}"
pre_script: collect.py
pre_provider: wechat-mp
prompt: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/不能同时配置/);
  });

  it("未知 pre_provider → 拒绝", () => {
    write("bad-provider.yaml", `
name: x
schedule: "0 9 * * *"
type: task
channel: "${VALID_CHANNEL}"
pre_provider: unknown
prompt: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/unknown pre_provider/);
  });

  it("timeout_sec > 1800 → 拒绝", () => {
    write("toolong.yaml", `
name: x
schedule: "0 9 * * *"
type: script
channel: "${VALID_CHANNEL}"
script: x.sh
timeout_sec: 3600
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/上限 1800/);
  });

  it("重名 job 第二个进 errors", () => {
    write("a.yaml", `name: dup\nschedule: "0 9 * * *"\ntype: message\nchannel: "${VALID_CHANNEL}"\ncontent: a\n`);
    write("b.yaml", `name: dup\nschedule: "0 10 * * *"\ntype: message\nchannel: "${VALID_CHANNEL}"\ncontent: b\n`);
    const r = loadCronJobs();
    expect(r.jobs.length).toBe(1);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].error).toMatch(/duplicate/);
  });
});

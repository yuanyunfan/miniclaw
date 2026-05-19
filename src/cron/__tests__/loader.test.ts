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

  it("解析 type=task + provider health preflight", () => {
    write("stock-pulse.yaml", `
name: stock-pulse
schedule: "*/30 * * * *"
enabled: true
type: task
channel: "${VALID_CHANNEL}"
pre_provider: stock-pulse
pre_provider_config: us-hourly
pre_provider_preflight: health
prompt: "总结盘中异动"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    const j = r.jobs[0];
    expect(j.type).toBe("task");
    if (j.type === "task") {
      expect(j.pre_provider).toBe("stock-pulse");
      expect(j.pre_provider_config).toBe("us-hourly");
      expect(j.pre_provider_preflight).toBe("health");
    }
  });

  it("解析 type=task + market-intel pre_provider", () => {
    write("market-intel.yaml", `
name: us-stock-pre-market
schedule: "45 8 * * 1-5"
timezone: America/New_York
enabled: true
type: task
channel: "${VALID_CHANNEL}"
pre_provider: market-intel
pre_provider_config: us-pre-market
prompt: "盘前市场分析"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    const j = r.jobs[0];
    expect(j.type).toBe("task");
    if (j.type === "task") {
      expect(j.pre_provider).toBe("market-intel");
      expect(j.pre_provider_config).toBe("us-pre-market");
    }
  });

  it("解析 type=task + pre_context_providers", () => {
    write("stock-with-context.yaml", `
name: us-stock-hourly-pulse
schedule: "30 21-23 * * 1-5"
enabled: true
type: task
channel: "${VALID_CHANNEL}"
pre_context_providers:
  - provider: market-context
    config: us-inject
  - provider: market-context
    config: cross-market-inject
    required: true
pre_provider: stock-pulse
pre_provider_config: us-hourly
prompt: "总结盘中异动"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    const j = r.jobs[0];
    expect(j.type).toBe("task");
    if (j.type === "task") {
      expect(j.pre_context_providers).toEqual([
        { provider: "market-context", config: "us-inject" },
        { provider: "market-context", config: "cross-market-inject", required: true },
      ]);
    }
  });

  it("解析 type=task + market-forecast-evaluation pre_provider", () => {
    write("market-forecast-evaluation.yaml", `
name: us-stock-post-market
schedule: "30 16 * * 1-5"
timezone: America/New_York
enabled: true
type: task
channel: "${VALID_CHANNEL}"
pre_provider: market-forecast-evaluation
pre_provider_config: us-post-market
prompt: "盘后预测校准"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    const j = r.jobs[0];
    expect(j.type).toBe("task");
    if (j.type === "task") {
      expect(j.pre_provider).toBe("market-forecast-evaluation");
      expect(j.pre_provider_config).toBe("us-post-market");
    }
  });

  it("解析 type=task + daily message group result delivery", () => {
    write("browser-tabs.yaml", `
name: browser-tabs-hourly
schedule: "0 * * * *"
timezone: Asia/Shanghai
enabled: true
type: task
channel: "${VALID_CHANNEL}"
result_delivery:
  mode: daily_message_group
  timezone: Asia/Shanghai
prompt: "整理浏览器标签页"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs.length).toBe(1);
    const j = r.jobs[0];
    expect(j.type).toBe("task");
    if (j.type === "task") {
      expect(j.result_delivery).toEqual({
        mode: "daily_message_group",
        timezone: "Asia/Shanghai",
      });
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
timeout_ms: 1800000
delivery_route: daily-watchlist-stock
max_concurrency: 2
cooldown:
  after_failure_ms: 600000
circuit_breaker:
  enabled: true
  failure_threshold: 4
  window_ms: 86400000
  open_ms: 3600000
missed_run:
  enabled: true
  grace_ms: 120000
  lookback_ms: 21600000
  max_records: 2
  catch_up: true
  max_catch_up: 1
content: "早安 {{date}}"
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    expect(r.jobs[0].enabled).toBe(true);
    expect(r.jobs[0].timeout_ms).toBe(1800000);
    expect(r.jobs[0].delivery_route).toBe("daily-watchlist-stock");
    expect(r.jobs[0].max_concurrency).toBe(2);
    expect(r.jobs[0].cooldown).toEqual({ after_failure_ms: 600000 });
    expect(r.jobs[0].circuit_breaker).toEqual({
      enabled: true,
      failure_threshold: 4,
      window_ms: 86400000,
      open_ms: 3600000,
    });
    expect(r.jobs[0].missed_run).toEqual({
      enabled: true,
      grace_ms: 120000,
      lookback_ms: 21600000,
      max_records: 2,
      catch_up: true,
      max_catch_up: 1,
    });
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
silent_success: true
timeout_sec: 600
`);
    const r = loadCronJobs();
    expect(r.errors).toEqual([]);
    if (r.jobs[0].type === "script") {
      expect(r.jobs[0].script).toBe("backup-db.sh");
      expect(r.jobs[0].args).toEqual(["--keep", "14"]);
      expect(r.jobs[0].timeout_sec).toBe(600);
      expect(r.jobs[0].capture_output).toBe(true);
      expect(r.jobs[0].silent_success).toBe(true);
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

  it("未知 pre_context provider → 拒绝", () => {
    write("bad-context-provider.yaml", `
name: x
schedule: "0 9 * * *"
type: task
channel: "${VALID_CHANNEL}"
pre_context_providers:
  - provider: unknown
prompt: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/unknown pre_context_providers\[0\]\.provider/);
  });

  it("pre_context provider config 含路径分隔符 → 拒绝", () => {
    write("bad-context-provider-config.yaml", `
name: x
schedule: "0 9 * * *"
type: task
channel: "${VALID_CHANNEL}"
pre_context_providers:
  - provider: market-context
    config: ../secret
prompt: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/路径分隔符/);
  });

  it("未知 pre_provider_preflight → 拒绝", () => {
    write("bad-provider-preflight.yaml", `
name: x
schedule: "0 9 * * *"
type: task
channel: "${VALID_CHANNEL}"
pre_provider: stock-pulse
pre_provider_preflight: full
prompt: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/pre_provider_preflight/);
  });

  it("pre_provider_preflight 没有 pre_provider → 拒绝", () => {
    write("orphan-provider-preflight.yaml", `
name: x
schedule: "0 9 * * *"
type: task
channel: "${VALID_CHANNEL}"
pre_provider_preflight: health
prompt: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/需要同时配置/);
  });

  it("未知 result_delivery.mode → 拒绝", () => {
    write("bad-result-delivery.yaml", `
name: x
schedule: "0 9 * * *"
type: task
channel: "${VALID_CHANNEL}"
result_delivery:
  mode: edit_everything
prompt: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/result_delivery\.mode/);
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

  it("timeout_ms 非正整数 → 拒绝", () => {
    write("bad-timeout-ms.yaml", `
name: x
schedule: "0 9 * * *"
type: message
channel: "${VALID_CHANNEL}"
timeout_ms: 0
content: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/timeout_ms.*正整数/);
  });

  it("max_concurrency 非正整数 → 拒绝", () => {
    write("bad-max-concurrency.yaml", `
name: x
schedule: "0 9 * * *"
type: message
channel: "${VALID_CHANNEL}"
max_concurrency: 0
content: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/max_concurrency.*正整数/);
  });

  it("cooldown.after_failure_ms 缺失或非法 → 拒绝", () => {
    write("bad-cooldown.yaml", `
name: x
schedule: "0 9 * * *"
type: message
channel: "${VALID_CHANNEL}"
cooldown: {}
content: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/cooldown\.after_failure_ms/);
  });

  it("circuit_breaker 字段非法 → 拒绝", () => {
    write("bad-circuit.yaml", `
name: x
schedule: "0 9 * * *"
type: message
channel: "${VALID_CHANNEL}"
circuit_breaker:
  enabled: yes
content: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/circuit_breaker\.enabled/);
  });

  it("missed_run 字段非法 → 拒绝", () => {
    write("bad-missed-run.yaml", `
name: x
schedule: "0 9 * * *"
type: message
channel: "${VALID_CHANNEL}"
missed_run:
  catch_up: "yes"
content: hi
`);
    const r = loadCronJobs();
    expect(r.errors[0].error).toMatch(/missed_run\.catch_up/);
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

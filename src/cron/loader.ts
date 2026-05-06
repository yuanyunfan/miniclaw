import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import cron from "node-cron";
import type { CronJob, CronJobLoadResult, CronJobType } from "./types.js";
import { isPreProviderName } from "../providers/index.js";

const CRON_DIR_DEFAULT = join(homedir(), ".miniclaw/cron");
const VALID_TYPES: CronJobType[] = ["task", "script", "skill", "message"];

const EXAMPLE_YAML = `# 示例 cron job —— 默认 disabled，照抄改 name + enabled: true 即可
# 文档: https://github.com/yuanyunfan/miniclaw#cron
#
# schedule 用 crontab 5 字段语法（分 时 日 月 周）
#   "0 9 * * *"      每天 9:00
#   "*/30 * * * *"   每 30 分钟
#   "0 9 * * 1-5"    工作日 9:00
#
# type 取值: task | script | skill | message
name: example-disabled
schedule: "0 9 * * *"
timezone: Asia/Shanghai
enabled: false
type: message
channel: "REPLACE_WITH_DISCORD_CHANNEL_ID"
content: "早安！今天 {{date}} ({{weekday}})。"
`;

function getCronDir(): string {
  return process.env.MINICLAW_CRON_DIR ?? CRON_DIR_DEFAULT;
}

function ensureCronDir(): string {
  const dir = getCronDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".example.yaml"), EXAMPLE_YAML);
  }
  return dir;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateJob(raw: unknown, file: string): CronJob {
  if (!isPlainObject(raw)) throw new Error(`${file}: top-level must be a YAML object`);
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string" || !r.name.trim()) throw new Error(`${file}: 'name' is required (string)`);
  if (typeof r.schedule !== "string" || !r.schedule.trim()) throw new Error(`${file}: 'schedule' is required (crontab string)`);
  if (!cron.validate(r.schedule)) throw new Error(`${file}: invalid cron schedule "${r.schedule}"`);

  const type = r.type;
  if (typeof type !== "string" || !VALID_TYPES.includes(type as CronJobType)) {
    throw new Error(`${file}: 'type' must be one of ${VALID_TYPES.join("|")}`);
  }
  if (typeof r.channel !== "string" || !/^\d{15,25}$/.test(r.channel)) {
    throw new Error(`${file}: 'channel' must be a Discord channel ID (numeric snowflake)`);
  }

  const enabled = r.enabled !== false; // 默认 true，除非显式 false
  const timezone = typeof r.timezone === "string" ? r.timezone : undefined;
  const baseCommon = {
    name: r.name.trim(),
    schedule: r.schedule,
    timezone,
    enabled,
    channel: r.channel,
  };

  if (type === "task") {
    if (typeof r.prompt !== "string" || !r.prompt.trim()) throw new Error(`${file}: type=task 需 'prompt'`);
    const preScript = typeof r.pre_script === "string" ? r.pre_script.trim() : undefined;
    const preProvider = typeof r.pre_provider === "string" ? r.pre_provider.trim() : undefined;
    if (preScript && preProvider) {
      throw new Error(`${file}: 'pre_script' 和 'pre_provider' 不能同时配置`);
    }
    if (preScript && (preScript.includes("/") || preScript.includes(".."))) {
      throw new Error(`${file}: 'pre_script' 必须是单一文件名（不含路径分隔符）`);
    }
    if (preProvider) {
      if (preProvider.includes("/") || preProvider.includes("..")) {
        throw new Error(`${file}: 'pre_provider' 必须是 provider 名称（不含路径分隔符）`);
      }
      if (!isPreProviderName(preProvider)) {
        throw new Error(`${file}: unknown pre_provider '${preProvider}'`);
      }
    }
    const preProviderConfig = typeof r.pre_provider_config === "string" ? r.pre_provider_config.trim() : undefined;
    if (preProviderConfig && (preProviderConfig.includes("/") || preProviderConfig.includes(".."))) {
      throw new Error(`${file}: 'pre_provider_config' 必须是配置名（不含路径分隔符）`);
    }
    const preTimeout = typeof r.pre_script_timeout_sec === "number" ? r.pre_script_timeout_sec : 120;
    if (preTimeout > 600) throw new Error(`${file}: 'pre_script_timeout_sec' 上限 600 (10 分钟)`);
    return {
      ...baseCommon,
      type: "task",
      prompt: r.prompt.trim(),
      cwd: typeof r.cwd === "string" ? r.cwd : undefined,
      ...(preScript ? {
        pre_script: preScript,
        pre_script_args: Array.isArray(r.pre_script_args) ? r.pre_script_args.map(String) : undefined,
        pre_script_timeout_sec: preTimeout,
      } : {}),
      ...(preProvider ? {
        pre_provider: preProvider,
        pre_provider_config: preProviderConfig,
      } : {}),
    };
  }

  if (type === "script") {
    if (typeof r.script !== "string" || !r.script.trim()) throw new Error(`${file}: type=script 需 'script' (脚本文件名)`);
    if (r.script.includes("/") || r.script.includes("..")) throw new Error(`${file}: 'script' 必须是单一文件名（不含路径分隔符）`);
    const timeout = typeof r.timeout_sec === "number" ? r.timeout_sec : 300;
    if (timeout > 1800) throw new Error(`${file}: 'timeout_sec' 上限 1800 (30 分钟)`);
    return {
      ...baseCommon,
      type: "script",
      script: r.script.trim(),
      args: Array.isArray(r.args) ? r.args.map(String) : undefined,
      capture_output: r.capture_output !== false,
      timeout_sec: timeout,
    };
  }

  if (type === "message") {
    if (typeof r.content !== "string" || !r.content.trim()) throw new Error(`${file}: type=message 需 'content'`);
    return { ...baseCommon, type: "message", content: r.content };
  }

  // type === "skill"
  if (typeof r.skill !== "string" || !r.skill.trim()) throw new Error(`${file}: type=skill 需 'skill' (skill 名)`);
  return {
    ...baseCommon,
    type: "skill",
    skill: r.skill.trim(),
    cwd: typeof r.cwd === "string" ? r.cwd : undefined,
    skill_args: isPlainObject(r.skill_args)
      ? Object.fromEntries(Object.entries(r.skill_args).map(([k, v]) => [k, String(v)]))
      : undefined,
  };
}

export function loadCronJobs(): CronJobLoadResult {
  const dir = ensureCronDir();
  const result: CronJobLoadResult = { jobs: [], errors: [] };
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f) && !f.startsWith("."));

  for (const file of files) {
    const path = join(dir, file);
    try {
      const raw = yamlLoad(readFileSync(path, "utf8"));
      const job = validateJob(raw, file);
      // 去重 by name
      if (result.jobs.some((j) => j.name === job.name)) {
        throw new Error(`${file}: duplicate job name '${job.name}' (already loaded from another file)`);
      }
      result.jobs.push(job);
    } catch (err) {
      result.errors.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}

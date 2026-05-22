import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import cron from "node-cron";
import type {
  CronJob,
  CronJobCircuitBreakerConfig,
  CronJobCooldownConfig,
  CronJobLoadResult,
  CronJobMissedRunConfig,
  CronJobPreContextProvider,
  CronTaskOutputContractConfig,
  CronTaskOutputContractValidator,
  CronTaskResultDeliveryConfig,
  CronTaskResultDeliveryMode,
  CronJobType,
  PreProviderPreflightMode,
} from "./types.js";
import { isPreProviderName } from "../providers/index.js";

const CRON_DIR_DEFAULT = join(homedir(), ".miniclaw/cron");
const VALID_TYPES: CronJobType[] = ["task", "script", "skill", "message"];
const VALID_PRE_PROVIDER_PREFLIGHT_MODES: PreProviderPreflightMode[] = ["off", "health", "dry_run"];
const VALID_TASK_RESULT_DELIVERY_MODES: CronTaskResultDeliveryMode[] = ["daily_message_group"];
const VALID_TASK_OUTPUT_CONTRACT_VALIDATORS: CronTaskOutputContractValidator[] = ["none"];
const OUTPUT_TEMPLATE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENCY = 50;
const MAX_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CIRCUIT_FAILURE_THRESHOLD = 100;
const MAX_CIRCUIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CIRCUIT_OPEN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MISSED_RUN_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_MISSED_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_MISSED_RUN_RECORDS = 50;
const MAX_MISSED_RUN_CATCH_UP = 10;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CIRCUIT_OPEN_MS = 60 * 60 * 1000;

const EXAMPLE_YAML = `# 示例 cron job —— 默认 disabled，照抄改 name + enabled: true 即可
# 文档: https://github.com/yuanyunfan/miniclaw#cron
#
# schedule 用 crontab 5 字段语法（分 时 日 月 周），也可以写成多条表达式数组
#   "0 9 * * *"      每天 9:00
#   "*/30 * * * *"   每 30 分钟
#   "0 9 * * 1-5"    工作日 9:00
#   ["30 21-23 * * 1-5", "30 0 * * 2-6"]  同一 job 多个触发窗口
#
# type 取值: task | script | skill | message
name: example-disabled
schedule: "0 9 * * *"
timezone: Asia/Shanghai
enabled: false
type: message
channel: "REPLACE_WITH_DISCORD_CHANNEL_ID"
# timeout_ms: 1800000       # 可选：完整 job wall-clock 超时（毫秒）
# delivery_route: ""        # 可选：额外投递到 config.yaml 里的 im.routes.<name>
# max_concurrency: 1        # 可选：同名 job 并发上限，默认 1
# cooldown:
#   after_failure_ms: 1800000
# circuit_breaker:
#   enabled: true
#   failure_threshold: 3
#   window_ms: 86400000
#   open_ms: 3600000
# missed_run:
#   enabled: true
#   grace_ms: 120000
#   lookback_ms: 21600000
#   max_records: 1
#   catch_up: false
#   max_catch_up: 1
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

function parseSchedule(value: unknown, file: string): string | string[] {
  if (typeof value === "string" && value.trim()) {
    if (!cron.validate(value)) throw new Error(`${file}: invalid cron schedule "${value}"`);
    return value.trim();
  }
  if (Array.isArray(value) && value.length > 0) {
    const schedules = value.map((item, index) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`${file}: schedule[${index}] must be a crontab string`);
      }
      const schedule = item.trim();
      if (!cron.validate(schedule)) throw new Error(`${file}: invalid cron schedule "${schedule}"`);
      return schedule;
    });
    return schedules;
  }
  throw new Error(`${file}: 'schedule' is required (crontab string or non-empty string array)`);
}

function parseOptionalPositiveInteger(
  value: unknown,
  file: string,
  field: string,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${file}: '${field}' 必须是正整数`);
  }
  if (value > max) throw new Error(`${file}: '${field}' 上限 ${max}`);
  return value;
}

function parseCooldownConfig(value: unknown, file: string): CronJobCooldownConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${file}: 'cooldown' 必须是对象`);
  const afterFailureMs = parseOptionalPositiveInteger(
    value.after_failure_ms,
    file,
    "cooldown.after_failure_ms",
    MAX_COOLDOWN_MS
  );
  if (afterFailureMs === undefined) {
    throw new Error(`${file}: 'cooldown.after_failure_ms' 是必填正整数`);
  }
  return { after_failure_ms: afterFailureMs };
}

function parseCircuitBreakerConfig(value: unknown, file: string): CronJobCircuitBreakerConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${file}: 'circuit_breaker' 必须是对象`);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(`${file}: 'circuit_breaker.enabled' 必须是 boolean`);
  }
  return {
    enabled: value.enabled !== false,
    failure_threshold: parseOptionalPositiveInteger(
      value.failure_threshold,
      file,
      "circuit_breaker.failure_threshold",
      MAX_CIRCUIT_FAILURE_THRESHOLD
    ) ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
    window_ms: parseOptionalPositiveInteger(
      value.window_ms,
      file,
      "circuit_breaker.window_ms",
      MAX_CIRCUIT_WINDOW_MS
    ) ?? DEFAULT_CIRCUIT_WINDOW_MS,
    open_ms: parseOptionalPositiveInteger(
      value.open_ms,
      file,
      "circuit_breaker.open_ms",
      MAX_CIRCUIT_OPEN_MS
    ) ?? DEFAULT_CIRCUIT_OPEN_MS,
  };
}

function parseMissedRunConfig(value: unknown, file: string): CronJobMissedRunConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${file}: 'missed_run' 必须是对象`);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(`${file}: 'missed_run.enabled' 必须是 boolean`);
  }
  if (value.catch_up !== undefined && typeof value.catch_up !== "boolean") {
    throw new Error(`${file}: 'missed_run.catch_up' 必须是 boolean`);
  }
  const graceMs = parseOptionalPositiveInteger(
    value.grace_ms,
    file,
    "missed_run.grace_ms",
    MAX_MISSED_RUN_GRACE_MS
  );
  const lookbackMs = parseOptionalPositiveInteger(
    value.lookback_ms,
    file,
    "missed_run.lookback_ms",
    MAX_MISSED_RUN_LOOKBACK_MS
  );
  const maxRecords = parseOptionalPositiveInteger(
    value.max_records,
    file,
    "missed_run.max_records",
    MAX_MISSED_RUN_RECORDS
  );
  const maxCatchUp = parseOptionalPositiveInteger(
    value.max_catch_up,
    file,
    "missed_run.max_catch_up",
    MAX_MISSED_RUN_CATCH_UP
  );
  return {
    ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
    ...(graceMs !== undefined ? { grace_ms: graceMs } : {}),
    ...(lookbackMs !== undefined ? { lookback_ms: lookbackMs } : {}),
    ...(maxRecords !== undefined ? { max_records: maxRecords } : {}),
    ...(value.catch_up !== undefined ? { catch_up: value.catch_up } : {}),
    ...(maxCatchUp !== undefined ? { max_catch_up: maxCatchUp } : {}),
  };
}

function parseTaskResultDeliveryConfig(value: unknown, file: string): CronTaskResultDeliveryConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${file}: 'result_delivery' 必须是对象`);
  if (typeof value.mode !== "string") {
    throw new Error(`${file}: 'result_delivery.mode' 必须是 ${VALID_TASK_RESULT_DELIVERY_MODES.join("|")}`);
  }
  const mode = value.mode.trim();
  if (!VALID_TASK_RESULT_DELIVERY_MODES.includes(mode as CronTaskResultDeliveryMode)) {
    throw new Error(`${file}: 'result_delivery.mode' 必须是 ${VALID_TASK_RESULT_DELIVERY_MODES.join("|")}`);
  }
  const timezone = typeof value.timezone === "string" && value.timezone.trim()
    ? value.timezone.trim()
    : undefined;
  return {
    mode: mode as CronTaskResultDeliveryMode,
    ...(timezone ? { timezone } : {}),
  };
}

function parseOutputTemplateId(value: unknown, file: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${file}: '${field}' 必须是模板 id`);
  }
  const template = value.trim();
  if (!OUTPUT_TEMPLATE_ID_RE.test(template) || template.includes("..")) {
    throw new Error(`${file}: '${field}' 只能是 slug（${OUTPUT_TEMPLATE_ID_RE.source}），不能包含路径或 '..'`);
  }
  return template;
}

function parseOutputContractVars(value: unknown, file: string, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${file}: '${field}' 必须是对象`);
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    if (raw === null || typeof raw === "object") {
      throw new Error(`${file}: '${field}.${key}' 必须是字符串、数字或 boolean`);
    }
    return [key, String(raw)];
  }));
}

function parseTaskOutputContractConfig(raw: Record<string, unknown>, file: string): CronTaskOutputContractConfig | undefined {
  const shorthandTemplate = raw.output_template;
  const shorthandVars = raw.output_template_vars;
  const advanced = raw.output_contract;
  if (shorthandTemplate !== undefined && advanced !== undefined) {
    throw new Error(`${file}: 'output_template' 和 'output_contract' 不能同时配置`);
  }
  if (shorthandVars !== undefined && shorthandTemplate === undefined) {
    throw new Error(`${file}: 'output_template_vars' 需要同时配置 'output_template'`);
  }
  if (shorthandTemplate !== undefined) {
    const vars = parseOutputContractVars(shorthandVars, file, "output_template_vars");
    return {
      template: parseOutputTemplateId(shorthandTemplate, file, "output_template"),
      ...(vars ? { vars } : {}),
      validator: "none",
    };
  }
  if (advanced === undefined) return undefined;
  if (!isPlainObject(advanced)) throw new Error(`${file}: 'output_contract' 必须是对象`);
  const template = parseOutputTemplateId(advanced.template, file, "output_contract.template");
  const vars = parseOutputContractVars(advanced.vars, file, "output_contract.vars");
  if (advanced.validator !== undefined && typeof advanced.validator !== "string") {
    throw new Error(`${file}: 'output_contract.validator' 必须是 ${VALID_TASK_OUTPUT_CONTRACT_VALIDATORS.join("|")}`);
  }
  const validator = typeof advanced.validator === "string" && advanced.validator.trim()
    ? advanced.validator.trim()
    : "none";
  if (!VALID_TASK_OUTPUT_CONTRACT_VALIDATORS.includes(validator as CronTaskOutputContractValidator)) {
    throw new Error(`${file}: 'output_contract.validator' 必须是 ${VALID_TASK_OUTPUT_CONTRACT_VALIDATORS.join("|")}`);
  }
  return {
    template,
    ...(vars ? { vars } : {}),
    validator: validator as CronTaskOutputContractValidator,
  };
}

function parseProviderName(value: unknown, file: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${file}: '${field}' 必须是 provider 名称`);
  }
  const provider = value.trim();
  if (provider.includes("/") || provider.includes("..")) {
    throw new Error(`${file}: '${field}' 必须是 provider 名称（不含路径分隔符）`);
  }
  if (!isPreProviderName(provider)) {
    throw new Error(`${file}: unknown ${field} '${provider}'`);
  }
  return provider;
}

function parseProviderConfigName(value: unknown, file: string, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${file}: '${field}' 必须是配置名`);
  }
  const config = value.trim();
  if (config.includes("/") || config.includes("..")) {
    throw new Error(`${file}: '${field}' 必须是配置名（不含路径分隔符）`);
  }
  return config;
}

function parsePreContextProviders(value: unknown, file: string): CronJobPreContextProvider[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${file}: 'pre_context_providers' 必须是数组`);
  const providers = value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new Error(`${file}: 'pre_context_providers[${index}]' 必须是对象`);
    }
    const provider = parseProviderName(item.provider, file, `pre_context_providers[${index}].provider`);
    const config = parseProviderConfigName(item.config, file, `pre_context_providers[${index}].config`);
    if (item.required !== undefined && typeof item.required !== "boolean") {
      throw new Error(`${file}: 'pre_context_providers[${index}].required' 必须是 boolean`);
    }
    return {
      provider,
      ...(config ? { config } : {}),
      ...(item.required !== undefined ? { required: item.required } : {}),
    };
  });
  if (!providers.length) throw new Error(`${file}: 'pre_context_providers' 不能为空数组`);
  return providers;
}

function validateJob(raw: unknown, file: string): CronJob {
  if (!isPlainObject(raw)) throw new Error(`${file}: top-level must be a YAML object`);
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string" || !r.name.trim()) throw new Error(`${file}: 'name' is required (string)`);
  const schedule = parseSchedule(r.schedule, file);

  const type = r.type;
  if (typeof type !== "string" || !VALID_TYPES.includes(type as CronJobType)) {
    throw new Error(`${file}: 'type' must be one of ${VALID_TYPES.join("|")}`);
  }
  if (typeof r.channel !== "string" || !/^\d{15,25}$/.test(r.channel)) {
    throw new Error(`${file}: 'channel' must be a Discord channel ID (numeric snowflake)`);
  }

  const enabled = r.enabled !== false; // 默认 true，除非显式 false
  const timezone = typeof r.timezone === "string" ? r.timezone : undefined;
  const timeoutMs = parseOptionalPositiveInteger(r.timeout_ms, file, "timeout_ms", MAX_TIMEOUT_MS);
  const maxConcurrency = parseOptionalPositiveInteger(r.max_concurrency, file, "max_concurrency", MAX_CONCURRENCY) ?? 1;
  const cooldown = parseCooldownConfig(r.cooldown, file);
  const circuitBreaker = parseCircuitBreakerConfig(r.circuit_breaker, file);
  const missedRun = parseMissedRunConfig(r.missed_run, file);
  const deliveryRoute = typeof r.delivery_route === "string" && r.delivery_route.trim()
    ? r.delivery_route.trim()
    : undefined;
  const baseCommon = {
    name: r.name.trim(),
    schedule,
    timezone,
    enabled,
    channel: r.channel,
    ...(deliveryRoute ? { delivery_route: deliveryRoute } : {}),
    max_concurrency: maxConcurrency,
    ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
    ...(cooldown ? { cooldown } : {}),
    ...(circuitBreaker ? { circuit_breaker: circuitBreaker } : {}),
    ...(missedRun ? { missed_run: missedRun } : {}),
  };

  if (type === "task") {
    if (typeof r.prompt !== "string" || !r.prompt.trim()) throw new Error(`${file}: type=task 需 'prompt'`);
    const resultDelivery = parseTaskResultDeliveryConfig(r.result_delivery, file);
    const outputContract = parseTaskOutputContractConfig(r, file);
    const preScript = typeof r.pre_script === "string" ? r.pre_script.trim() : undefined;
    const preProvider = typeof r.pre_provider === "string" ? r.pre_provider.trim() : undefined;
    if (preScript && preProvider) {
      throw new Error(`${file}: 'pre_script' 和 'pre_provider' 不能同时配置`);
    }
    if (preScript && (preScript.includes("/") || preScript.includes(".."))) {
      throw new Error(`${file}: 'pre_script' 必须是单一文件名（不含路径分隔符）`);
    }
    if (preProvider) {
      parseProviderName(preProvider, file, "pre_provider");
    }
    const preProviderConfig = parseProviderConfigName(r.pre_provider_config, file, "pre_provider_config");
    const preContextProviders = parsePreContextProviders(r.pre_context_providers, file);
    let preProviderPreflight: PreProviderPreflightMode | undefined;
    if (r.pre_provider_preflight !== undefined) {
      if (typeof r.pre_provider_preflight !== "string") {
        throw new Error(`${file}: 'pre_provider_preflight' 必须是 ${VALID_PRE_PROVIDER_PREFLIGHT_MODES.join("|")}`);
      }
      const rawMode = r.pre_provider_preflight.trim();
      if (!VALID_PRE_PROVIDER_PREFLIGHT_MODES.includes(rawMode as PreProviderPreflightMode)) {
        throw new Error(`${file}: 'pre_provider_preflight' 必须是 ${VALID_PRE_PROVIDER_PREFLIGHT_MODES.join("|")}`);
      }
      if (!preProvider) {
        throw new Error(`${file}: 'pre_provider_preflight' 需要同时配置 'pre_provider'`);
      }
      preProviderPreflight = rawMode as PreProviderPreflightMode;
    }
    const preTimeout = typeof r.pre_script_timeout_sec === "number" ? r.pre_script_timeout_sec : 120;
    if (preTimeout > 600) throw new Error(`${file}: 'pre_script_timeout_sec' 上限 600 (10 分钟)`);
    return {
      ...baseCommon,
      type: "task",
      prompt: r.prompt.trim(),
      cwd: typeof r.cwd === "string" ? r.cwd : undefined,
      ...(resultDelivery ? { result_delivery: resultDelivery } : {}),
      ...(outputContract ? { output_contract: outputContract } : {}),
      ...(preContextProviders ? { pre_context_providers: preContextProviders } : {}),
      ...(preScript ? {
        pre_script: preScript,
        pre_script_args: Array.isArray(r.pre_script_args) ? r.pre_script_args.map(String) : undefined,
        pre_script_timeout_sec: preTimeout,
      } : {}),
      ...(preProvider ? {
        pre_provider: preProvider,
        pre_provider_config: preProviderConfig,
        ...(preProviderPreflight && preProviderPreflight !== "off"
          ? { pre_provider_preflight: preProviderPreflight }
          : {}),
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
      silent_success: r.silent_success === true,
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

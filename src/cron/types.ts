export type CronJobType = "task" | "script" | "skill" | "message";
export type PreProviderPreflightMode = "off" | "health" | "dry_run";

export interface CronJobCooldownConfig {
  after_failure_ms: number;
}

export interface CronJobCircuitBreakerConfig {
  enabled: boolean;
  failure_threshold: number;
  window_ms: number;
  open_ms: number;
}

export interface CronJobMissedRunConfig {
  /**
   * Detect expected schedules that never reached dispatch. Defaults to true.
   */
  enabled?: boolean;
  /**
   * Do not audit the most recent schedule until this grace window has elapsed.
   */
  grace_ms?: number;
  /**
   * Startup/periodic audit lookback window. Defaults are applied by scheduler.
   */
  lookback_ms?: number;
  /**
   * Maximum missed schedule rows to record per job per audit pass.
   */
  max_records?: number;
  /**
   * Whether a detected missed schedule should be executed once as catch-up.
   */
  catch_up?: boolean;
  /**
   * Maximum catch-up dispatches per job per audit pass.
   */
  max_catch_up?: number;
}

export interface CronJobPreContextProvider {
  provider: string;
  config?: string;
  /**
   * Defaults to false. Optional context providers should not block the primary
   * cron report when their context is absent or temporarily unavailable.
   */
  required?: boolean;
}

export interface CronJobBase {
  name: string;
  schedule: string | string[];
  timezone?: string;
  enabled: boolean;
  type: CronJobType;
  channel: string; // Primary Discord channel ID for output (除非 type=script 且 capture_output=false)
  /**
   * Optional logical IM delivery route. The legacy Discord channel remains the
   * primary target; route targets are used for extra outbound delivery.
   */
  delivery_route?: string;
  /**
   * Optional full-job wall clock timeout. This wraps the complete cron path
   * (pre-script/pre-provider/task/script/message) at scheduler level.
   */
  timeout_ms?: number;
  /**
   * Per-job concurrency limit by job name. Defaults to 1 to preserve the
   * historical "skip if previous run is still active" behavior.
   */
  max_concurrency?: number;
  /**
   * Optional post-failure cooldown. New dispatches during the cooldown window
   * are recorded as skipped rows in cron_runs instead of silently ignored.
   */
  cooldown?: CronJobCooldownConfig;
  /**
   * Optional rolling-window circuit breaker backed by durable cron_runs history.
   */
  circuit_breaker?: CronJobCircuitBreakerConfig;
  /**
   * Optional expected-schedule audit. A missed trigger is recorded as
   * cron_runs.status=missed; catch_up is opt-in per job.
   */
  missed_run?: CronJobMissedRunConfig;
}

export interface CronJobTask extends CronJobBase {
  type: "task";
  prompt: string;
  cwd?: string;
  /**
   * 可选：在调用 LLM 之前先跑这个脚本（在 ~/.miniclaw/scripts/ 下），
   * stdout 会被拼到 prompt 顶部作为"采集到的数据"，让 LLM 基于真实数据做分析。
   * 替代 hermes 的 script+prompt 组合模式。
   */
  pre_script?: string;
  pre_script_args?: string[];
  pre_script_timeout_sec?: number;
  /**
   * 可选：在调用 LLM 之前运行内置 provider，stdout-like 文本会被拼到 prompt 顶部。
   * 和 pre_script 互斥；适合需要长期维护、可测试的采集逻辑。
   */
  pre_provider?: string;
  pre_provider_config?: string;
  /**
   * Optional low-priority context providers that run before pre_script/pre_provider
   * and prepend additional background. They can coexist with the primary
   * pre_provider and are intended for rolling context such as market memory.
   */
  pre_context_providers?: CronJobPreContextProvider[];
  /**
   * Optional provider framework preflight before the legacy pre_provider run.
   * Defaults to off to preserve existing cron behavior.
   */
  pre_provider_preflight?: PreProviderPreflightMode;
}

export interface CronJobScript extends CronJobBase {
  type: "script";
  script: string;            // 相对 ~/.miniclaw/scripts/ 的文件名
  args?: string[];
  capture_output?: boolean;  // true → stdout/stderr 转发到 channel
  silent_success?: boolean;  // true → exit=0 且无 DISCORD_MESSAGE/MEDIA 输出时不发成功状态
  timeout_sec?: number;      // 默认 300（5 分钟），上限 1800（30 分钟）
}

export interface CronJobMessage extends CronJobBase {
  type: "message";
  content: string;           // 支持 {{date}} {{weekday}} {{cron.name}} 等模板
}

export interface CronJobSkill extends CronJobBase {
  type: "skill";
  skill: string;             // ~/.miniclaw/skills/<skill>.md 的文件名（不含扩展名）
  cwd?: string;
  skill_args?: Record<string, string>;
}

export type CronJob = CronJobTask | CronJobScript | CronJobMessage | CronJobSkill;

export interface CronJobRunOutcome {
  status: "success" | "skipped";
  taskId?: string;
  providerName?: string;
  providerStatus?: string;
  providerCategory?: string;
  errorCategory?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface CronJobRunContext {
  signal?: AbortSignal;
  onTaskId?: (taskId: string) => void;
}

export interface CronJobLoadResult {
  jobs: CronJob[];
  errors: Array<{ file: string; error: string }>;
}

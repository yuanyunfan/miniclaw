export type CronJobType = "task" | "script" | "skill" | "message";

export interface CronJobBase {
  name: string;
  schedule: string | string[];
  timezone?: string;
  enabled: boolean;
  type: CronJobType;
  channel: string; // Discord channel ID for output (除非 type=script 且 capture_output=false)
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
}

export interface CronJobScript extends CronJobBase {
  type: "script";
  script: string;            // 相对 ~/.miniclaw/scripts/ 的文件名
  args?: string[];
  capture_output?: boolean;  // true → stdout/stderr 转发到 channel
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

export interface CronJobLoadResult {
  jobs: CronJob[];
  errors: Array<{ file: string; error: string }>;
}

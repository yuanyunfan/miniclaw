export type CronJobType = "task" | "script" | "skill" | "message";

export interface CronJobBase {
  name: string;
  schedule: string;
  timezone?: string;
  enabled: boolean;
  type: CronJobType;
  channel: string; // Discord channel ID for output (除非 type=script 且 capture_output=false)
}

export interface CronJobTask extends CronJobBase {
  type: "task";
  prompt: string;
  cwd?: string;
  budget_usd?: number;
  max_turns?: number;
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
  budget_usd?: number;
  max_turns?: number;
  skill_args?: Record<string, string>;
}

export type CronJob = CronJobTask | CronJobScript | CronJobMessage | CronJobSkill;

export interface CronJobLoadResult {
  jobs: CronJob[];
  errors: Array<{ file: string; error: string }>;
}

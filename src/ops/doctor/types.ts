export type DoctorMode = "recent" | "task" | "cron";
export type DoctorIncidentType =
  | "task_failed"
  | "task_interrupted"
  | "task_running_too_long"
  | "cron_failed"
  | "chat_error"
  | "discord_outage"
  | "pm2_restart_loop"
  | "unknown";
export type DoctorSeverity = "info" | "warning" | "critical";
export type DoctorCategory =
  | "user_prompt"
  | "network"
  | "discord"
  | "provider_data"
  | "provider_auth"
  | "miniclaw_bug"
  | "third_party"
  | "unknown";

export interface DoctorTaskRow {
  id: string;
  status: string;
  prompt: string;
  cwd?: string | null;
  session_id?: string | null;
  discord_thread_id?: string | null;
  source_route_type?: string | null;
  source_channel_id?: string | null;
  source_message_url?: string | null;
  result_summary?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
}

export interface DoctorTaskEventRow {
  id: number;
  task_id: string;
  event_type: string;
  severity: string;
  message?: string | null;
  payload_json?: string | null;
  created_at: string;
}

export interface DoctorCronJobState {
  name: string;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  last_duration_ms?: number;
  completed?: number;
  last_attempt?: number;
  max_attempts?: number;
  next_retry_at?: string;
  failure_run_id?: string;
}

export interface DoctorPm2State {
  app: string;
  found: boolean;
  status?: string;
  pid?: number;
  restartCount?: number;
  unstableRestarts?: number;
  uptimeMs?: number;
  error?: string;
}

export interface DoctorGitState {
  cwd: string;
  branch?: string;
  sha?: string;
  remote?: string;
  dirtyFiles: string[];
  error?: string;
}

export interface DoctorConnectivityState {
  status?: string;
  updated_at?: string;
  consecutive_failures?: number;
  checks?: Record<string, unknown>;
  error?: string;
}

export interface DoctorLogEvidence {
  path: string;
  lines: string[];
  missing?: boolean;
}

export interface DoctorEvidence {
  generatedAt: string;
  mode: DoctorMode;
  subject?: string;
  dbPath: string;
  cronStatePath: string;
  connectivityStatePath: string;
  task?: DoctorTaskRow;
  taskCandidates: DoctorTaskRow[];
  taskEvents: DoctorTaskEventRow[];
  cron?: DoctorCronJobState;
  cronErrors: DoctorCronJobState[];
  pm2: DoctorPm2State;
  git: DoctorGitState;
  connectivity: DoctorConnectivityState;
  logs: DoctorLogEvidence[];
}

export interface DoctorDiagnosis {
  incidentType: DoctorIncidentType;
  severity: DoctorSeverity;
  category: DoctorCategory;
  title: string;
  summary: string;
  evidenceSummary: string[];
  repairAllowed: boolean;
  recommendedAction: string;
}

export interface DoctorReport {
  evidence: DoctorEvidence;
  diagnosis: DoctorDiagnosis;
}

export interface DoctorArgs {
  mode: DoctorMode;
  taskIdPrefix?: string;
  cronJobName?: string;
  json: boolean;
  dbPath?: string;
  cronStatePath?: string;
  connectivityStatePath?: string;
  logDir?: string;
  cwd?: string;
  pm2App?: string;
}

export type CommandRunner = (cmd: string, args: string[], cwd?: string) => string;

export interface RunDoctorOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  commandRunner?: CommandRunner;
}

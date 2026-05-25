import {
  CLI_SESSION_PHASES,
  CLI_SESSION_PROVIDERS,
  type CliSessionDashboardBucket,
  type CliSessionDashboardItem,
  type CliSessionPhase,
  type CliSessionProvider,
  type CliSessionRow,
} from "./types.js";

const ACTIVE_PHASES = new Set<CliSessionPhase>([
  "processing",
  "running_tool",
  "waiting_for_approval",
  "compacting",
]);

export function isCliSessionProvider(value: string): value is CliSessionProvider {
  return (CLI_SESSION_PROVIDERS as readonly string[]).includes(value);
}

export function isCliSessionPhase(value: string): value is CliSessionPhase {
  return (CLI_SESSION_PHASES as readonly string[]).includes(value);
}

function normalizeEventName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function mapHookEventToPhase(
  provider: CliSessionProvider,
  eventName: string,
  explicitPhase?: string,
): CliSessionPhase {
  if (explicitPhase && isCliSessionPhase(explicitPhase)) return explicitPhase;

  const normalized = normalizeEventName(eventName);
  if (!normalized) return "unknown";

  if (normalized === "sessionstart" || normalized === "startup" || normalized === "resume") {
    return "starting";
  }
  if (normalized === "userpromptsubmit" || normalized === "prompt" || normalized === "message") {
    return "processing";
  }
  if (normalized === "pretooluse" || normalized === "toolstart" || normalized === "toolcall") {
    return "running_tool";
  }
  if (normalized === "posttooluse" || normalized === "toolend" || normalized === "toolresult") {
    return "processing";
  }
  if (normalized === "permissionrequest" || normalized === "approvalrequest") {
    return "waiting_for_approval";
  }
  if (normalized === "precompact" || normalized === "compact" || normalized === "compaction") {
    return "compacting";
  }
  if (normalized === "stop" || normalized === "turnend" || normalized === "responsecompleted") {
    return "waiting_for_input";
  }
  if (normalized === "sessionend" || normalized === "exit" || normalized === "ended") {
    return "ended";
  }

  if (provider === "codex" && normalized === "execcommandbegin") return "running_tool";
  if (provider === "codex" && normalized === "execcommandend") return "processing";

  return "unknown";
}

export function isActiveCliSessionPhase(phase: CliSessionPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

export function isEmptyCodexStartupSession(session: CliSessionRow): boolean {
  return session.provider === "codex"
    && session.phase === "starting"
    && session.observed_prompt_count === 0
    && !session.transcript_activity_at;
}

export function classifyCliSessionForDashboard(
  session: CliSessionRow,
  now = new Date(),
  staleActiveMs = 15 * 60 * 1000,
): CliSessionDashboardItem {
  const quietMs = Math.max(0, now.getTime() - Date.parse(session.last_activity_at));
  let bucket: CliSessionDashboardBucket;
  if (session.hidden_at) {
    bucket = "hidden";
  } else if (session.phase === "ended" || session.ended_at) {
    bucket = "closed";
  } else if (session.phase === "waiting_for_approval") {
    bucket = "approval";
  } else if (isActiveCliSessionPhase(session.phase)) {
    bucket = quietMs >= staleActiveMs ? "stale_active" : "active";
  } else if (session.phase === "waiting_for_input") {
    bucket = "idle";
  } else {
    bucket = "active";
  }

  const priority: Record<CliSessionDashboardBucket, number> = {
    approval: 0,
    active: 1,
    stale_active: 2,
    idle: 3,
    closed: 4,
    hidden: 5,
  };
  return { session, bucket, quietMs, priority: priority[bucket] };
}

export function sortCliSessionsForDashboard(
  sessions: CliSessionRow[],
  options: {
    now?: Date;
    staleActiveMs?: number;
    includeHidden?: boolean;
    includeClosed?: boolean;
    includeEmptyCodexStartup?: boolean;
  } = {},
): CliSessionDashboardItem[] {
  const now = options.now ?? new Date();
  const staleActiveMs = options.staleActiveMs ?? 15 * 60 * 1000;
  return sessions
    .filter((session) => options.includeHidden || !session.hidden_at)
    .filter((session) => options.includeClosed || (session.phase !== "ended" && !session.ended_at))
    .filter((session) => options.includeEmptyCodexStartup || !isEmptyCodexStartupSession(session))
    .map((session) => classifyCliSessionForDashboard(session, now, staleActiveMs))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const attentionA = a.session.attention_kind ? 0 : 1;
      const attentionB = b.session.attention_kind ? 0 : 1;
      if (attentionA !== attentionB) return attentionA - attentionB;
      return Date.parse(b.session.last_activity_at) - Date.parse(a.session.last_activity_at);
    });
}

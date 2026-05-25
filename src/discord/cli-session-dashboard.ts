import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { sortCliSessionsForDashboard } from "../hookd/state.js";
import type {
  CliSessionApprovalRow,
  CliSessionDashboardBucket,
  CliSessionDashboardItem,
  CliSessionProvider,
  CliSessionRow,
} from "../hookd/types.js";

export const CLI_SESSION_CUSTOM_ID_PREFIX = "miniclaw:cli-session:";

export type CliSessionButtonAction = "details" | "hide";
export type CliSessionApprovalButtonAction = "approve" | "deny";

export interface CliSessionDashboardFilters {
  provider?: CliSessionProvider;
  status?: "all" | "active" | "idle" | "closed" | "hidden";
  project?: string;
}

export interface CliSessionDashboardMessage {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

function ellipsis(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function bucketLabel(bucket: CliSessionDashboardBucket): string {
  switch (bucket) {
    case "approval":
      return "waiting_for_approval";
    case "active":
      return "active";
    case "stale_active":
      return "active quiet";
    case "idle":
      return "idle";
    case "closed":
      return "closed";
    case "hidden":
      return "hidden";
  }
}

function bucketTitle(bucket: CliSessionDashboardBucket): string {
  switch (bucket) {
    case "approval":
      return "Approval";
    case "active":
      return "Active";
    case "stale_active":
      return "Stale Active";
    case "idle":
      return "Idle";
    case "closed":
      return "History";
    case "hidden":
      return "Hidden";
  }
}

function sessionLine(item: CliSessionDashboardItem): string {
  const session = item.session;
  const id = session.id.slice(0, 8);
  const hint = session.terminal_app ?? session.tty ?? "-";
  const prompt = session.latest_prompt ?? session.latest_summary ?? session.last_event_name ?? "(no summary)";
  const quiet = item.bucket === "stale_active" ? `, quiet ${duration(item.quietMs)}` : "";
  return [
    `**${id}** [${session.provider}] ${bucketLabel(item.bucket)}${quiet}`,
    `cwd: \`${ellipsis(session.cwd, 72)}\``,
    `hint: ${ellipsis(hint, 32)} · last: ${duration(item.quietMs)} ago`,
    ellipsis(prompt.replace(/\s+/g, " "), 140),
  ].join("\n");
}

function groupByBucket(items: CliSessionDashboardItem[]): Map<CliSessionDashboardBucket, CliSessionDashboardItem[]> {
  const grouped = new Map<CliSessionDashboardBucket, CliSessionDashboardItem[]>();
  for (const item of items) {
    const current = grouped.get(item.bucket) ?? [];
    current.push(item);
    grouped.set(item.bucket, current);
  }
  return grouped;
}

function buildActionRows(
  items: CliSessionDashboardItem[],
  pendingApprovals: Record<string, CliSessionApprovalRow | undefined> = {},
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const visible = items
    .filter((item) => item.bucket !== "closed" && item.bucket !== "hidden")
    .slice(0, 5);
  if (!visible.length) return rows;

  const approvals = visible
    .filter((item) => item.bucket === "approval")
    .map((item) => pendingApprovals[item.session.id])
    .filter((approval): approval is CliSessionApprovalRow => Boolean(approval))
    .slice(0, 2);
  for (const approval of approvals) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCliSessionApprovalCustomId("approve", approval.id))
        .setLabel(`Approve ${approval.id.slice(0, 4)}`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildCliSessionApprovalCustomId("deny", approval.id))
        .setLabel(`Deny ${approval.id.slice(0, 4)}`)
        .setStyle(ButtonStyle.Danger),
    ));
  }

  const detailRow = new ActionRowBuilder<ButtonBuilder>();
  for (const item of visible) {
    detailRow.addComponents(
      new ButtonBuilder()
        .setCustomId(buildCliSessionCustomId("details", item.session.id))
        .setLabel(`Details ${item.session.id.slice(0, 4)}`)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  rows.push(detailRow);

  const idle = visible.filter((item) => item.bucket === "idle").slice(0, 5);
  if (idle.length) {
    const continueRow = new ActionRowBuilder<ButtonBuilder>();
    for (const item of idle) {
      continueRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildCliSessionCustomId("continue", item.session.id))
          .setLabel(`Continue ${item.session.id.slice(0, 4)}`)
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(continueRow);
  }

  const hideRow = new ActionRowBuilder<ButtonBuilder>();
  for (const item of visible.slice(0, 5)) {
    hideRow.addComponents(
      new ButtonBuilder()
        .setCustomId(buildCliSessionCustomId("hide", item.session.id))
        .setLabel(`Hide ${item.session.id.slice(0, 4)}`)
        .setStyle(ButtonStyle.Danger)
    );
  }
  rows.push(hideRow);
  return rows;
}

export function buildCliSessionCustomId(action: CliSessionButtonAction | "continue", sessionId: string): string {
  return `${CLI_SESSION_CUSTOM_ID_PREFIX}${action}:${sessionId}`;
}

export function buildCliSessionApprovalCustomId(action: CliSessionApprovalButtonAction, approvalId: string): string {
  return `${CLI_SESSION_CUSTOM_ID_PREFIX}${action}:${approvalId}`;
}

export function parseCliSessionCustomId(customId: string): { action: CliSessionButtonAction | "continue"; sessionId: string } | { action: CliSessionApprovalButtonAction; approvalId: string } | null {
  if (!customId.startsWith(CLI_SESSION_CUSTOM_ID_PREFIX)) return null;
  const rest = customId.slice(CLI_SESSION_CUSTOM_ID_PREFIX.length);
  const [action, ...idParts] = rest.split(":");
  const sessionId = idParts.join(":");
  if ((action === "details" || action === "hide" || action === "continue") && sessionId) return { action, sessionId };
  if ((action === "approve" || action === "deny") && sessionId) return { action, approvalId: sessionId };
  return null;
}

export function buildCliSessionContinueModalId(sessionId: string): string {
  return `${CLI_SESSION_CUSTOM_ID_PREFIX}continue-submit:${sessionId}`;
}

export function parseCliSessionContinueModalId(customId: string): { sessionId: string } | null {
  if (!customId.startsWith(`${CLI_SESSION_CUSTOM_ID_PREFIX}continue-submit:`)) return null;
  const sessionId = customId.slice(`${CLI_SESSION_CUSTOM_ID_PREFIX}continue-submit:`.length);
  return sessionId ? { sessionId } : null;
}

export function buildCliSessionDashboardMessage(input: {
  sessions: CliSessionRow[];
  filters?: CliSessionDashboardFilters;
  now?: Date;
  staleActiveMs?: number;
  limit?: number;
  pendingApprovals?: Record<string, CliSessionApprovalRow | undefined>;
}): CliSessionDashboardMessage {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const includeClosed = input.filters?.status === "closed";
  const includeHidden = input.filters?.status === "hidden";
  const items = sortCliSessionsForDashboard(input.sessions, {
    now: input.now,
    staleActiveMs: input.staleActiveMs,
    includeClosed,
    includeHidden,
  }).slice(0, limit);
  const grouped = groupByBucket(items);
  const counts = items.reduce<Record<CliSessionDashboardBucket, number>>((acc, item) => {
    acc[item.bucket]++;
    return acc;
  }, {
    approval: 0,
    active: 0,
    stale_active: 0,
    idle: 0,
    closed: 0,
    hidden: 0,
  });

  const filterText = [
    input.filters?.provider ? `provider=${input.filters.provider}` : undefined,
    input.filters?.status && input.filters.status !== "all" ? `status=${input.filters.status}` : undefined,
    input.filters?.project ? `project=${input.filters.project}` : undefined,
  ].filter(Boolean).join(" · ") || "all active/idle sessions";

  const embed = new EmbedBuilder()
    .setTitle("MiniClaw CLI Sessions")
    .setDescription([
      "State-prioritized Discord view for observed Claude Code and Codex CLI sessions.",
      `Filter: ${filterText}`,
      `Counts: approval ${counts.approval} · active ${counts.active} · stale ${counts.stale_active} · idle ${counts.idle}`,
    ].join("\n"))
    .setColor(counts.approval > 0 ? 0xe67e22 : counts.active + counts.stale_active > 0 ? 0x3498db : 0x95a5a6)
    .setTimestamp(input.now ?? new Date());

  for (const bucket of ["approval", "active", "stale_active", "idle", "closed", "hidden"] as const) {
    const bucketItems = grouped.get(bucket) ?? [];
    if (!bucketItems.length) continue;
    embed.addFields({
      name: `${bucketTitle(bucket)} (${bucketItems.length})`,
      value: ellipsis(bucketItems.map(sessionLine).join("\n\n"), 1024),
      inline: false,
    });
  }

  if (!items.length) {
    embed.addFields({
      name: "No sessions",
      value: "No matching observed CLI sessions. Start hookd and send provider hook events to populate this view.",
      inline: false,
    });
  }

  return {
    embeds: [embed],
    components: buildActionRows(items, input.pendingApprovals),
  };
}

export function buildCliSessionDetailEmbed(session: CliSessionRow): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`CLI Session ${session.id.slice(0, 8)}`)
    .setColor(session.phase === "ended" ? 0x95a5a6 : session.phase === "waiting_for_approval" ? 0xe67e22 : 0x3498db)
    .addFields(
      { name: "Provider", value: session.provider, inline: true },
      { name: "Phase", value: session.phase, inline: true },
      { name: "Provider Session", value: ellipsis(session.provider_session_id, 96), inline: false },
      { name: "cwd", value: ellipsis(session.cwd, 256), inline: false },
      { name: "Terminal", value: ellipsis(session.terminal_app ?? session.tty ?? "-", 128), inline: true },
      { name: "pid", value: session.pid === null ? "-" : String(session.pid), inline: true },
      { name: "Last Event", value: session.last_event_name ?? "-", inline: true },
      { name: "Latest", value: ellipsis(session.latest_prompt ?? session.latest_summary ?? "-", 1000), inline: false },
    )
    .setTimestamp(new Date(session.last_activity_at));
}

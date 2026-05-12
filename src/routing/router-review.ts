import type { SmartRouterReviewRow } from "../store/db.js";

export interface RouterReviewWindow {
  since?: string;
  until?: string;
  channelId?: string;
}

export interface RouterReviewCount {
  key: string;
  count: number;
}

export interface RouterReviewSummary {
  generatedAt: string;
  window: RouterReviewWindow;
  total: number;
  byChannel: RouterReviewCount[];
  byIntent: RouterReviewCount[];
  byClassifierError: RouterReviewCount[];
  byUserChoice: RouterReviewCount[];
  byFinalRoute: RouterReviewCount[];
  byTaskOutcome: RouterReviewCount[];
  byCorrectionType: RouterReviewCount[];
  recent: RouterReviewRecentDecision[];
}

export interface RouterReviewRecentDecision {
  id: number;
  createdAt: string;
  channelId: string;
  intent: string;
  actionResult: string;
  userChoice: string;
  finalRoute: string;
  taskFinalStatus: string;
  correctionType: string;
  promptHash: string;
}

function label(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "none";
}

function countBy(rows: SmartRouterReviewRow[], keyFn: (row: SmartRouterReviewRow) => string): RouterReviewCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function renderCounts(title: string, counts: RouterReviewCount[]): string[] {
  return [
    "",
    title,
    ...(counts.length ? counts.map((row) => `- ${row.key}: ${row.count}`) : ["- none: 0"]),
  ];
}

function short(value: string | null | undefined, chars: number): string {
  const text = label(value);
  return text.length <= chars ? text : `${text.slice(0, chars - 3)}...`;
}

function hashLabel(value: string | null | undefined): string {
  const text = label(value);
  return text === "none" ? "none" : text.slice(0, 12);
}

function recentDecision(row: SmartRouterReviewRow): RouterReviewRecentDecision {
  return {
    id: row.id,
    createdAt: row.created_at,
    channelId: row.channel_id,
    intent: row.intent,
    actionResult: label(row.action_result),
    userChoice: label(row.user_choice),
    finalRoute: label(row.final_route),
    taskFinalStatus: label(row.task_final_status ?? row.linked_task_status),
    correctionType: label(row.correction_type),
    promptHash: hashLabel(row.prompt_hash),
  };
}

export function summarizeSmartRouterReview(
  rows: SmartRouterReviewRow[],
  window: RouterReviewWindow = {},
  generatedAt = new Date().toISOString()
): RouterReviewSummary {
  return {
    generatedAt,
    window,
    total: rows.length,
    byChannel: countBy(rows, (row) => row.channel_id),
    byIntent: countBy(rows, (row) => row.intent),
    byClassifierError: countBy(rows, (row) => label(row.classifier_error_type)),
    byUserChoice: countBy(rows, (row) => label(row.user_choice)),
    byFinalRoute: countBy(rows, (row) => label(row.final_route)),
    byTaskOutcome: countBy(rows, (row) => label(row.task_final_status ?? row.linked_task_status)),
    byCorrectionType: countBy(rows, (row) => label(row.correction_type)),
    recent: rows.slice(0, 20).map(recentDecision),
  };
}

export function renderSmartRouterReview(summary: RouterReviewSummary): string {
  const lines = [
    `Smart Router review | generated_at=${summary.generatedAt}`,
    [
      `since=${label(summary.window.since)}`,
      `until=${label(summary.window.until)}`,
      `channel=${label(summary.window.channelId)}`,
      `decisions=${summary.total}`,
    ].join(" | "),
    ...renderCounts("By final route", summary.byFinalRoute),
    ...renderCounts("By user choice", summary.byUserChoice),
    ...renderCounts("By task outcome", summary.byTaskOutcome),
    ...renderCounts("By correction type", summary.byCorrectionType),
    ...renderCounts("By intent", summary.byIntent),
    ...renderCounts("By classifier error", summary.byClassifierError),
    ...renderCounts("By channel", summary.byChannel),
    "",
    "Recent decisions",
  ];

  if (!summary.recent.length) {
    lines.push("- none");
  } else {
    for (const row of summary.recent) {
      lines.push(
        [
          `- #${row.id}`,
          row.createdAt,
          `ch=${short(row.channelId, 10)}`,
          `intent=${row.intent}`,
          `action=${row.actionResult}`,
          `choice=${row.userChoice}`,
          `route=${row.finalRoute}`,
          `task=${row.taskFinalStatus}`,
          `correction=${row.correctionType}`,
          `hash=${row.promptHash}`,
        ].join(" | ")
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

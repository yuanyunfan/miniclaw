import { randomBytes } from "node:crypto";
import type { Attachment } from "discord.js";
import type { RouteDecision } from "./intent.js";

export type ConfirmationAction = "task" | "chat" | "cancel";
export type ConfirmationStatus = "pending" | "accepted" | "continued_chat" | "cancelled" | "expired";

export interface PendingTaskConfirmation {
  id: string;
  userId: string;
  channelId: string;
  messageId: string;
  prompt: string;
  displayPrompt: string;
  cwd: string;
  attachments: Attachment[];
  decision: RouteDecision;
  decisionLogId?: number;
  createdAt: number;
  expiresAt: number;
  status: ConfirmationStatus;
}

export interface CreateConfirmationInput {
  userId: string;
  channelId: string;
  messageId: string;
  prompt: string;
  displayPrompt?: string;
  cwd: string;
  attachments?: Attachment[];
  decision: RouteDecision;
  decisionLogId?: number;
  ttlMs: number;
  now?: number;
}

const PREFIX = "miniclaw:smart";
const confirmations = new Map<string, PendingTaskConfirmation>();

function newToken(): string {
  return randomBytes(9).toString("base64url");
}

export function buildSmartRouterCustomId(action: ConfirmationAction, id: string): string {
  return `${PREFIX}:${action}:${id}`;
}

export function parseSmartRouterCustomId(customId: string): { action: ConfirmationAction; id: string } | undefined {
  const parts = customId.split(":");
  if (parts.length !== 4 || parts[0] !== "miniclaw" || parts[1] !== "smart") return undefined;
  const action = parts[2];
  if (action !== "task" && action !== "chat" && action !== "cancel") return undefined;
  return { action, id: parts[3] };
}

export function createPendingConfirmation(input: CreateConfirmationInput): PendingTaskConfirmation {
  pruneExpired(input.now ?? Date.now());
  const now = input.now ?? Date.now();
  const row: PendingTaskConfirmation = {
    id: newToken(),
    userId: input.userId,
    channelId: input.channelId,
    messageId: input.messageId,
    prompt: input.prompt,
    displayPrompt: input.displayPrompt ?? input.prompt,
    cwd: input.cwd,
    attachments: input.attachments ?? [],
    decision: input.decision,
    ...(input.decisionLogId !== undefined ? { decisionLogId: input.decisionLogId } : {}),
    createdAt: now,
    expiresAt: now + input.ttlMs,
    status: "pending",
  };
  confirmations.set(row.id, row);
  return row;
}

export function getPendingConfirmation(id: string, now = Date.now()): PendingTaskConfirmation | undefined {
  const row = confirmations.get(id);
  if (!row) return undefined;
  if (row.status === "pending" && row.expiresAt <= now) {
    row.status = "expired";
    confirmations.delete(id);
    return { ...row };
  }
  return row;
}

export function consumePendingConfirmation(
  id: string,
  action: ConfirmationAction,
  userId: string,
  now = Date.now()
): { ok: true; confirmation: PendingTaskConfirmation } | { ok: false; reason: "missing" | "expired" | "unauthorized" | "used" } {
  const row = confirmations.get(id);
  if (!row) return { ok: false, reason: "missing" };
  if (row.userId !== userId) return { ok: false, reason: "unauthorized" };
  if (row.status !== "pending") return { ok: false, reason: "used" };
  if (row.expiresAt <= now) {
    row.status = "expired";
    confirmations.delete(id);
    return { ok: false, reason: "expired" };
  }

  row.status = action === "task" ? "accepted" : action === "chat" ? "continued_chat" : "cancelled";
  confirmations.delete(id);
  return { ok: true, confirmation: row };
}

export function pruneExpired(now = Date.now()): number {
  let removed = 0;
  for (const [id, row] of confirmations) {
    if (row.expiresAt > now) continue;
    row.status = "expired";
    confirmations.delete(id);
    removed++;
  }
  return removed;
}

export function __clearConfirmationsForTests(): void {
  confirmations.clear();
}

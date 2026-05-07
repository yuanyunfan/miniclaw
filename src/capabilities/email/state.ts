import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { resolveEmailHome } from "./config.js";
import { hashValue } from "./redaction.js";
import type { EmailMessage, EmailSeenMessageEntry, EmailState } from "./types.js";

function emptyState(): EmailState {
  return { updated_at: new Date().toISOString(), provider_cursor: {}, seen_messages: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function loadEmailState(path: string): EmailState {
  const resolved = resolveEmailHome(path);
  if (!existsSync(resolved)) return emptyState();
  try {
    const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
    if (!isPlainObject(raw)) return emptyState();
    return {
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString(),
      provider_cursor: isPlainObject(raw.provider_cursor) ? raw.provider_cursor : {},
      seen_messages: isPlainObject(raw.seen_messages) ? raw.seen_messages as Record<string, EmailSeenMessageEntry> : {},
    };
  } catch {
    return emptyState();
  }
}

export function saveEmailState(path: string, state: EmailState): void {
  const resolved = resolveEmailHome(path);
  mkdirSync(dirname(resolved), { recursive: true });
  state.updated_at = new Date().toISOString();
  const tmp = `${resolved}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  chmodSync(tmp, 0o600);
  renameSync(tmp, resolved);
}

export function emailSeenKey(message: Pick<EmailMessage, "folder" | "provider_uid" | "message_id_hash">): string {
  return hashValue(`${message.folder}:${message.provider_uid}:${message.message_id_hash}`);
}

export function isEmailMessageSeen(state: EmailState, message: Pick<EmailMessage, "folder" | "provider_uid" | "message_id_hash">): boolean {
  return Boolean(state.seen_messages[emailSeenKey(message)]);
}

export function markEmailMessagesSeen(state: EmailState, messages: EmailMessage[]): void {
  const seenAt = new Date().toISOString();
  for (const message of messages) {
    state.seen_messages[emailSeenKey(message)] = {
      folder: message.folder,
      provider_uid: message.provider_uid,
      message_id_hash: message.message_id_hash,
      subject_hash: hashValue(message.subject),
      received_at: message.received_at,
      seen_at: seenAt,
    };
  }
}

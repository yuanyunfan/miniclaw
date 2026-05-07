import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { resolveEmailHome } from "../../capabilities/email/config.js";
import type { CmbCreditCardState, CmbCreditCardStateEntry, CmbCreditCardTransaction } from "./types.js";

function emptyState(): CmbCreditCardState {
  return { updated_at: new Date().toISOString(), seen_transactions: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function loadCmbCreditCardState(path: string): CmbCreditCardState {
  const resolved = resolveEmailHome(path);
  if (!existsSync(resolved)) return emptyState();
  try {
    const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
    if (!isPlainObject(raw)) return emptyState();
    return {
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString(),
      seen_transactions: isPlainObject(raw.seen_transactions)
        ? raw.seen_transactions as Record<string, CmbCreditCardStateEntry>
        : {},
    };
  } catch {
    return emptyState();
  }
}

export function saveCmbCreditCardState(path: string, state: CmbCreditCardState): void {
  const resolved = resolveEmailHome(path);
  mkdirSync(dirname(resolved), { recursive: true });
  state.updated_at = new Date().toISOString();
  const tmp = `${resolved}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  chmodSync(tmp, 0o600);
  renameSync(tmp, resolved);
}

export function isTransactionSeen(state: CmbCreditCardState, transaction: CmbCreditCardTransaction): boolean {
  return Boolean(state.seen_transactions[transaction.id]);
}

export function markTransactionsSeen(state: CmbCreditCardState, transactions: CmbCreditCardTransaction[]): void {
  const seenAt = new Date().toISOString();
  for (const transaction of transactions) {
    state.seen_transactions[transaction.id] = {
      transaction_id: transaction.id,
      message_id_hash: transaction.message_id_hash,
      amount: transaction.amount,
      currency: transaction.currency,
      occurred_at: transaction.occurred_at,
      seen_at: seenAt,
    };
  }
}

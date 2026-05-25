import {
  createCliSessionApproval,
  expirePendingCliSessionApprovals,
  getCliSessionApproval,
  resolveCliSessionApproval,
  timeoutCliSessionApproval,
} from "../store/db.js";
import type {
  CliSessionApprovalDecision,
  CliSessionApprovalRow,
  CliSessionHookEvent,
  CliSessionRow,
} from "./types.js";

export interface HookdApprovalRequestParams {
  session: CliSessionRow;
  event: CliSessionHookEvent;
  timeoutMs: number;
}

export interface HookdApprovalResult {
  approvalRequestId: string;
  decision: CliSessionApprovalDecision;
  reason?: string;
}

interface PendingApproval {
  timer: NodeJS.Timeout;
  resolve: (result: HookdApprovalResult) => void;
}

function decisionFromRow(row: CliSessionApprovalRow): HookdApprovalResult {
  let reason: string | undefined;
  if (row.decision_json) {
    try {
      const parsed = JSON.parse(row.decision_json) as { reason?: unknown };
      if (typeof parsed.reason === "string" && parsed.reason.trim()) reason = parsed.reason;
    } catch {
      // Ignore malformed historical rows; the status is enough to fail closed.
    }
  }
  if (row.status === "approved") return { approvalRequestId: row.id, decision: "allow", ...(reason ? { reason } : {}) };
  if (row.status === "ask") return { approvalRequestId: row.id, decision: "ask", ...(reason ? { reason } : {}) };
  return {
    approvalRequestId: row.id,
    decision: "deny",
    reason: reason ?? (row.status === "timed_out" ? "Permission request timed out in MiniClaw" : "Permission request denied by MiniClaw"),
  };
}

export class HookdApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>();

  async requestApproval(params: HookdApprovalRequestParams): Promise<HookdApprovalResult> {
    const approval = createCliSessionApproval(params);
    if (params.timeoutMs <= 0) {
      const resolved = timeoutCliSessionApproval({
        id: approval.id,
        reason: "Permission request timed out in MiniClaw",
      }) ?? approval;
      return decisionFromRow(resolved);
    }

    return await new Promise<HookdApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(approval.id);
        const resolved = timeoutCliSessionApproval({
          id: approval.id,
          reason: "Permission request timed out in MiniClaw",
        }) ?? approval;
        resolve({
          approvalRequestId: approval.id,
          decision: "deny",
          reason: decisionFromRow(resolved).reason,
        });
      }, params.timeoutMs);
      timer.unref?.();
      this.pending.set(approval.id, { timer, resolve });
    });
  }

  resolve(id: string, decision: CliSessionApprovalDecision, actorId?: string, reason?: string): HookdApprovalResult | undefined {
    const row = resolveCliSessionApproval({ id, decision, actorId, reason });
    if (!row) return undefined;
    const result = decisionFromRow(row);
    const pending = this.pending.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve(result);
    }
    return result;
  }

  expireStartupPending(): number {
    const expired = expirePendingCliSessionApprovals({
      status: "expired",
      reason: "MiniClaw restarted before the provider hook request resolved",
      includeUnexpired: true,
    });
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      const row = getCliSessionApproval(id);
      pending.resolve(row ? decisionFromRow(row) : {
        approvalRequestId: id,
        decision: "deny",
        reason: "MiniClaw restarted before the provider hook request resolved",
      });
    }
    return expired;
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}

export const hookdApprovalRegistry = new HookdApprovalRegistry();

export const __testables = {
  decisionFromRow,
};

import { createLogger } from "../lib/log.js";

const log = createLogger("shutdown");

export const DRAINING_MESSAGE = "MiniClaw 正在重启/关闭，当前不接收新任务，请稍后重试。";
export const SHUTDOWN_DRAIN_TIMEOUT_SUMMARY = "Interrupted during MiniClaw shutdown drain timeout";
export const SHUTDOWN_FORCE_SUMMARY = "Interrupted during forced MiniClaw shutdown";

let draining = false;
let drainReason: string | undefined;

export function isDraining(): boolean {
  return draining;
}

export function getDrainReason(): string | undefined {
  return drainReason;
}

export function beginDraining(reason: string): boolean {
  if (draining) return false;
  draining = true;
  drainReason = reason;
  log.warn(`Entering shutdown drain: ${reason}`);
  return true;
}

export function resetDrainingForTest(): void {
  draining = false;
  drainReason = undefined;
}

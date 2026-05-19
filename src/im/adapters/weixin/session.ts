const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;

export const WEIXIN_SESSION_EXPIRED_ERRCODE = -14;

const pausedUntilByAccount = new Map<string, number>();

export function pauseWeixinSession(accountId: string, now = Date.now()): number {
  const until = now + SESSION_PAUSE_DURATION_MS;
  pausedUntilByAccount.set(accountId, until);
  return until;
}

export function getWeixinSessionPauseRemainingMs(accountId: string, now = Date.now()): number {
  const until = pausedUntilByAccount.get(accountId);
  if (until === undefined) return 0;
  const remaining = until - now;
  if (remaining <= 0) {
    pausedUntilByAccount.delete(accountId);
    return 0;
  }
  return remaining;
}

export function assertWeixinSessionActive(accountId: string): void {
  const remaining = getWeixinSessionPauseRemainingMs(accountId);
  if (remaining <= 0) return;
  const minutes = Math.ceil(remaining / 60_000);
  throw new Error(`Weixin session paused for account=${accountId}; ${minutes} min remaining after errcode ${WEIXIN_SESSION_EXPIRED_ERRCODE}`);
}

export function isWeixinSessionExpiredCode(code: number | undefined): boolean {
  return code === WEIXIN_SESSION_EXPIRED_ERRCODE;
}

export function isWeixinSessionExpiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(` ${WEIXIN_SESSION_EXPIRED_ERRCODE}:`) || message.includes(`errcode ${WEIXIN_SESSION_EXPIRED_ERRCODE}`);
}

export function __resetWeixinSessionPauseForTests(): void {
  pausedUntilByAccount.clear();
}

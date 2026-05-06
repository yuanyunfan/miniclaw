export class WechatMpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WechatMpError";
  }
}

export class WechatMpInvalidSessionError extends WechatMpError {
  constructor(message = "wechat mp session is invalid or expired") {
    super(message);
    this.name = "WechatMpInvalidSessionError";
  }
}

export class WechatMpFrequencyControlError extends WechatMpError {
  constructor(message = "wechat mp frequency control triggered") {
    super(message);
    this.name = "WechatMpFrequencyControlError";
  }
}

export function sanitizeWechatMpError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/token=\d+/gi, "token=<redacted>")
    .replace(/"token"\s*:\s*"[^"]+"/gi, "\"token\":\"<redacted>\"")
    .replace(/(slave_sid|slave_user|bizuin|data_bizuin)=([^;,\s]+)/gi, "$1=<redacted>")
    .slice(0, 500);
}

export function assertWechatRet(payload: unknown, context: string): void {
  const obj = payload as Record<string, unknown>;
  const base = obj?.base_resp as Record<string, unknown> | undefined;
  const retRaw = obj?.ret ?? base?.ret;
  const msgRaw = obj?.err_msg ?? base?.err_msg;
  const ret = typeof retRaw === "number" ? retRaw : typeof retRaw === "string" ? Number(retRaw) : 0;
  const msg = typeof msgRaw === "string" ? msgRaw : "";

  if (!ret || ret === 0) return;
  if (ret === 200003 || /invalid\s*session/i.test(msg)) {
    throw new WechatMpInvalidSessionError(`${context}: invalid session (${ret}${msg ? ` ${msg}` : ""})`);
  }
  if (ret === 200013 || /frequency/i.test(msg)) {
    throw new WechatMpFrequencyControlError(`${context}: frequency control (${ret}${msg ? ` ${msg}` : ""})`);
  }
  throw new WechatMpError(`${context}: wechat returned ret=${ret}${msg ? ` err_msg=${msg}` : ""}`);
}

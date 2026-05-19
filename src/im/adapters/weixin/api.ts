import { randomBytes, randomUUID } from "node:crypto";

export const DEFAULT_WEIXIN_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_WEIXIN_BOT_TYPE = "3";
export const DEFAULT_WEIXIN_CHANNEL_VERSION = "2.4.3";

export const WeixinMessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const WeixinMessageType = {
  USER: 1,
  BOT: 2,
} as const;

export const WeixinMessageState = {
  FINISH: 2,
} as const;

export interface WeixinTextItem {
  text?: string;
}

export interface WeixinMessageItem {
  type?: number;
  text_item?: WeixinTextItem;
  voice_item?: { text?: string };
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  message_type?: number;
  message_state?: number;
  item_list?: WeixinMessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

export interface NotifyResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

export interface QrStartResp {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QrStatusResp {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect" | "need_verifycode" | "verify_code_blocked" | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

export interface WeixinApiOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  channelVersion?: string;
  botAgent?: string;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function clientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function baseInfo(options: WeixinApiOptions) {
  return {
    channel_version: options.channelVersion ?? DEFAULT_WEIXIN_CHANNEL_VERSION,
    bot_agent: options.botAgent ?? "MiniClaw",
  };
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function endpointUrl(baseUrl: string | undefined, endpoint: string): string {
  return new URL(endpoint, ensureTrailingSlash(baseUrl || DEFAULT_WEIXIN_BASE_URL)).toString();
}

function headers(options: WeixinApiOptions): Record<string, string> {
  const out: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String(clientVersion(options.channelVersion ?? DEFAULT_WEIXIN_CHANNEL_VERSION)),
  };
  if (options.token?.trim()) out.Authorization = `Bearer ${options.token.trim()}`;
  return out;
}

async function fetchText(url: string, init: RequestInit, timeoutMs: number, fetchFn?: typeof fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (fetchFn ?? fetch)(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Weixin HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(endpoint: string, body: unknown, options: WeixinApiOptions = {}): Promise<T> {
  const text = await fetchText(
    endpointUrl(options.baseUrl, endpoint),
    {
      method: "POST",
      headers: headers(options),
      body: JSON.stringify(body),
    },
    options.timeoutMs ?? 15_000,
    options.fetchFn,
  );
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

async function getJson<T>(endpoint: string, options: WeixinApiOptions = {}): Promise<T> {
  const text = await fetchText(
    endpointUrl(options.baseUrl, endpoint),
    {
      method: "GET",
      headers: headers(options),
    },
    options.timeoutMs ?? 35_000,
    options.fetchFn,
  );
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export async function getWeixinUpdates(params: {
  getUpdatesBuf?: string;
  options: WeixinApiOptions;
}): Promise<GetUpdatesResp> {
  try {
    return await postJson<GetUpdatesResp>("ilink/bot/getupdates", {
      get_updates_buf: params.getUpdatesBuf ?? "",
      base_info: baseInfo(params.options),
    }, {
      ...params.options,
      timeoutMs: params.options.timeoutMs ?? 35_000,
    });
  } catch (err) {
    if (isAbortError(err)) {
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
    }
    throw err;
  }
}

export function buildWeixinTextMessage(params: {
  to: string;
  text: string;
  contextToken?: string;
  clientId?: string;
}) {
  return {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: params.clientId ?? randomUUID(),
      message_type: WeixinMessageType.BOT,
      message_state: WeixinMessageState.FINISH,
      item_list: params.text
        ? [{ type: WeixinMessageItemType.TEXT, text_item: { text: params.text } }]
        : undefined,
      context_token: params.contextToken || undefined,
    },
  };
}

export async function sendWeixinText(params: {
  to: string;
  text: string;
  contextToken?: string;
  options: WeixinApiOptions;
}): Promise<{ messageId: string }> {
  const clientId = randomUUID();
  const resp = await postJson<SendMessageResp>(
    "ilink/bot/sendmessage",
    {
      ...buildWeixinTextMessage({
        to: params.to,
        text: params.text,
        contextToken: params.contextToken,
        clientId,
      }),
      base_info: baseInfo(params.options),
    },
    params.options,
  );
  const code = resp.errcode ?? resp.ret ?? 0;
  if (code !== 0) {
    throw new Error(`Weixin sendmessage error ${code}: ${resp.errmsg ?? "unknown error"}`);
  }
  return { messageId: clientId };
}

export async function notifyWeixinStart(options: WeixinApiOptions): Promise<NotifyResp> {
  return postJson<NotifyResp>("ilink/bot/msg/notifystart", {
    base_info: baseInfo(options),
  }, {
    ...options,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
}

export async function notifyWeixinStop(options: WeixinApiOptions): Promise<NotifyResp> {
  return postJson<NotifyResp>("ilink/bot/msg/notifystop", {
    base_info: baseInfo(options),
  }, {
    ...options,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
}

export async function startWeixinQrLogin(options: WeixinApiOptions = {}): Promise<QrStartResp> {
  return postJson<QrStartResp>(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_WEIXIN_BOT_TYPE)}`,
    { local_token_list: [] },
    { ...options, baseUrl: DEFAULT_WEIXIN_BASE_URL, timeoutMs: options.timeoutMs ?? 35_000 },
  );
}

export async function pollWeixinQrLogin(params: {
  qrcode: string;
  verifyCode?: string;
  options?: WeixinApiOptions;
}): Promise<QrStatusResp> {
  const verify = params.verifyCode ? `&verify_code=${encodeURIComponent(params.verifyCode)}` : "";
  return getJson<QrStatusResp>(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}${verify}`,
    { baseUrl: DEFAULT_WEIXIN_BASE_URL, ...(params.options ?? {}), timeoutMs: params.options?.timeoutMs ?? 35_000 },
  );
}

export function extractWeixinText(message: WeixinMessage): string {
  for (const item of message.item_list ?? []) {
    if (item.type === WeixinMessageItemType.TEXT && item.text_item?.text) return item.text_item.text;
    if (item.type === WeixinMessageItemType.VOICE && item.voice_item?.text) return item.voice_item.text;
  }
  return "";
}

export const __testables = {
  clientVersion,
  headers,
  endpointUrl,
  baseInfo,
};

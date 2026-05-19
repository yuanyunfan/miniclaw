import type { IMTransport, SentMessage } from "../../contracts.js";
import { createLogger } from "../../../lib/log.js";
import { sendWeixinText, DEFAULT_WEIXIN_BASE_URL, isWeixinSendMessageErrorCode } from "./api.js";
import { sendWeixinMediaFile } from "./media.js";
import {
  clearWeixinContextToken,
  getWeixinContextToken,
  resolveWeixinAccount,
  type WeixinAccountData,
} from "./store.js";
import { assertWeixinSessionActive, isWeixinSessionExpiredError, pauseWeixinSession } from "./session.js";

export interface WeixinTransportOptions {
  stateDir?: string;
  defaultAccountId?: string;
  fetchFn?: typeof fetch;
}

const log = createLogger("weixin-transport");

function resolveAccount(options: WeixinTransportOptions, accountId?: string): WeixinAccountData {
  return resolveWeixinAccount(accountId ?? options.defaultAccountId, options.stateDir);
}

function resolveContextToken(options: WeixinTransportOptions, account: WeixinAccountData, target: string, explicit?: string): {
  contextToken?: string;
  fromStore: boolean;
} {
  if (explicit !== undefined) return { contextToken: explicit || undefined, fromStore: false };
  return {
    contextToken: getWeixinContextToken(account.accountId, target, options.stateDir),
    fromStore: true,
  };
}

function clearStoredContextToken(options: WeixinTransportOptions, account: WeixinAccountData, target: string, fromStore: boolean): void {
  if (!fromStore) return;
  clearWeixinContextToken(account.accountId, target, options.stateDir);
}

async function retryWithoutContextOnSendMinus2<T>(params: {
  account: WeixinAccountData;
  target: string;
  contextToken?: string;
  contextTokenFromStore: boolean;
  options: WeixinTransportOptions;
  operation: (contextToken?: string) => Promise<T>;
}): Promise<T> {
  try {
    return await params.operation(params.contextToken);
  } catch (err) {
    if (isWeixinSessionExpiredError(err)) pauseWeixinSession(params.account.accountId);
    if (!params.contextToken || !isWeixinSendMessageErrorCode(err, -2)) throw err;

    clearStoredContextToken(params.options, params.account, params.target, params.contextTokenFromStore);
    log.warn(
      `weixin sendmessage returned -2 with context token account=${params.account.accountId} ` +
      `to=${params.target}; retrying once without context_token`
    );
    try {
      return await params.operation(undefined);
    } catch (retryErr) {
      if (isWeixinSessionExpiredError(retryErr)) pauseWeixinSession(params.account.accountId);
      throw retryErr;
    }
  }
}

export function createWeixinTransport(options: WeixinTransportOptions = {}): IMTransport {
  return {
    id: "weixin",
    kind: "im_transport",
    capabilities: {
      richEmbeds: false,
      markdown: "plain",
      editMessage: false,
      threads: false,
      files: true,
      buttons: false,
      slashCommands: false,
      mentions: false,
    },
    async send(input): Promise<SentMessage> {
      const account = resolveAccount(options, input.target.accountId);
      assertWeixinSessionActive(account.accountId);
      const context = resolveContextToken(options, account, input.target.target, input.target.contextToken);
      const sent = await retryWithoutContextOnSendMinus2({
        account,
        target: input.target.target,
        contextToken: context.contextToken,
        contextTokenFromStore: context.fromStore,
        options,
        operation: (contextToken) => sendWeixinText({
          to: input.target.target,
          text: input.content.slice(0, 4000),
          contextToken,
          options: {
            baseUrl: account.baseUrl || DEFAULT_WEIXIN_BASE_URL,
            token: account.token,
            fetchFn: options.fetchFn,
          },
        }),
      });
      return {
        transport: "weixin",
        target: input.target.target,
        accountId: account.accountId,
        messageId: sent.messageId,
      };
    },
    async sendFile(input): Promise<void> {
      const account = resolveAccount(options, input.target.accountId);
      assertWeixinSessionActive(account.accountId);
      const context = resolveContextToken(options, account, input.target.target, input.target.contextToken);
      await retryWithoutContextOnSendMinus2({
        account,
        target: input.target.target,
        contextToken: context.contextToken,
        contextTokenFromStore: context.fromStore,
        options,
        operation: (contextToken) => sendWeixinMediaFile({
          filePath: input.path,
          to: input.target.target,
          text: input.description,
          contextToken,
          options: {
            baseUrl: account.baseUrl || DEFAULT_WEIXIN_BASE_URL,
            token: account.token,
            fetchFn: options.fetchFn,
          },
        }),
      });
    },
  };
}

import type { IMTransport, SentMessage } from "../../contracts.js";
import { sendWeixinText, DEFAULT_WEIXIN_BASE_URL } from "./api.js";
import {
  getWeixinContextToken,
  resolveWeixinAccount,
  type WeixinAccountData,
} from "./store.js";

export interface WeixinTransportOptions {
  stateDir?: string;
  defaultAccountId?: string;
  fetchFn?: typeof fetch;
}

function resolveAccount(options: WeixinTransportOptions, accountId?: string): WeixinAccountData {
  return resolveWeixinAccount(accountId ?? options.defaultAccountId, options.stateDir);
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
      files: false,
      buttons: false,
      slashCommands: false,
      mentions: false,
    },
    async send(input): Promise<SentMessage> {
      const account = resolveAccount(options, input.target.accountId);
      const contextToken = input.target.contextToken
        ?? getWeixinContextToken(account.accountId, input.target.target, options.stateDir);
      const sent = await sendWeixinText({
        to: input.target.target,
        text: input.content.slice(0, 4000),
        contextToken,
        options: {
          baseUrl: account.baseUrl || DEFAULT_WEIXIN_BASE_URL,
          token: account.token,
          fetchFn: options.fetchFn,
        },
      });
      return {
        transport: "weixin",
        target: input.target.target,
        accountId: account.accountId,
        messageId: sent.messageId,
      };
    },
  };
}

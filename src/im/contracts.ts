import type { IMTransportId } from "../config/types.js";

export type IMTransportKind = "im_transport";
export type IMMarkdownMode = "discord" | "feishu" | "plain";

export interface IMCapabilities {
  richEmbeds: boolean;
  markdown: IMMarkdownMode;
  editMessage: boolean;
  threads: boolean;
  files: boolean;
  buttons: boolean;
  slashCommands: boolean;
  mentions: boolean;
}

export interface IMDeliveryTarget {
  transport: IMTransportId;
  target: string;
  threadId?: string;
}

export interface MessageRef {
  transport: IMTransportId;
  target: string;
  messageId: string;
  threadId?: string;
}

export interface ThreadRef {
  transport: IMTransportId;
  target: string;
  threadId: string;
}

export interface SentMessage extends MessageRef {
  url?: string;
}

export interface SendMessageInput {
  target: IMDeliveryTarget;
  content: string;
  suppressEmbeds?: boolean;
  components?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface EditMessageInput {
  message: MessageRef;
  content: string;
}

export interface CreateThreadInput {
  target: IMDeliveryTarget;
  name: string;
  parentMessageId?: string;
}

export interface SendFileInput {
  target: IMDeliveryTarget;
  path: string;
  name?: string;
  description?: string;
}

export interface IMTransport {
  id: IMTransportId;
  kind: IMTransportKind;
  capabilities: IMCapabilities;
  send(input: SendMessageInput): Promise<SentMessage>;
  edit?(input: EditMessageInput): Promise<void>;
  createThread?(input: CreateThreadInput): Promise<ThreadRef>;
  sendFile?(input: SendFileInput): Promise<void>;
}

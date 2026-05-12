export type IMTransportKind = "im_transport";

export interface MessageRef {
  channelId: string;
  messageId: string;
  threadId?: string;
}

export interface ThreadRef {
  channelId: string;
  threadId: string;
}

export interface SentMessage extends MessageRef {
  url?: string;
}

export interface SendMessageInput {
  channelId: string;
  content: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export interface EditMessageInput {
  message: MessageRef;
  content: string;
}

export interface CreateThreadInput {
  channelId: string;
  name: string;
  parentMessageId?: string;
}

export interface SendFileInput {
  channelId: string;
  path: string;
  name?: string;
  description?: string;
  threadId?: string;
}

export interface IMTransport {
  id: string;
  kind: IMTransportKind;
  send(input: SendMessageInput): Promise<SentMessage>;
  edit(input: EditMessageInput): Promise<void>;
  createThread(input: CreateThreadInput): Promise<ThreadRef>;
  sendFile(input: SendFileInput): Promise<void>;
}

export type ModelClientKind = "model_client";
export type ModelResponseFormat = "text" | "json";

export interface ModelCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCompletionInput {
  prompt?: string;
  messages?: ModelCompletionMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ModelResponseFormat;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ModelCompletionResult {
  text: string;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  raw?: unknown;
}

export interface ModelClassificationInput<T> extends ModelCompletionInput {
  parse: (text: string) => T;
}

export interface ModelClient {
  id: string;
  kind: ModelClientKind;
  complete(input: ModelCompletionInput): Promise<ModelCompletionResult>;
  classify?<T>(input: ModelClassificationInput<T>): Promise<T>;
}

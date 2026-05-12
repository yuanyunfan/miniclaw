import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { ThreadOptions } from "@openai/codex-sdk";
import { codexThreadOptions, getCodexClient, withCodexTimeout } from "../agent/codex.js";
import type {
  ModelClassificationInput,
  ModelClient,
  ModelCompletionInput,
  ModelCompletionMessage,
  ModelCompletionResult,
} from "./model-client.js";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

let anthropicClient: Anthropic | null = null;

export type OpenAiModelClientProvider = "openai" | "openai_compatible";

export type AnthropicMessagesClient = Pick<Anthropic, "messages">;

export interface AnthropicMessagesModelClientOptions {
  id: string;
  model: string;
  timeoutMs: number;
  client?: AnthropicMessagesClient;
  apiKey?: string;
  baseUrl?: string;
}

export interface OpenAiChatModelClientOptions {
  id: string;
  provider: OpenAiModelClientProvider;
  model: string;
  timeoutMs: number;
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface CodexThreadModelClientOptions {
  id: string;
  timeoutMs: number;
  cwd?: string;
  model?: string;
  getClient?: typeof getCodexClient;
}

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  model?: string;
};

function getAnthropicClient(options: AnthropicMessagesModelClientOptions): AnthropicMessagesClient {
  if (options.client) return options.client;
  if (!anthropicClient) {
    if (!options.apiKey) throw new Error("Anthropic API key is not configured");
    anthropicClient = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
  }
  return anthropicClient;
}

function withClassification(client: Omit<ModelClient, "classify">): ModelClient {
  return {
    ...client,
    classify: async <T>(input: ModelClassificationInput<T>) => {
      const result = await client.complete(input);
      return input.parse(result.text);
    },
  };
}

function timeoutController(input: ModelCompletionInput, timeoutMs: number, message: string): AbortController {
  const ctrl = new AbortController();
  const forwardAbort = () => ctrl.abort(input.signal?.reason ?? new Error("Model client aborted"));
  if (input.signal?.aborted) {
    forwardAbort();
    return ctrl;
  }

  const timer = setTimeout(() => ctrl.abort(new Error(message)), timeoutMs);
  timer.unref?.();

  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  ctrl.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardAbort);
  }, { once: true });
  return ctrl;
}

function completionMessages(input: ModelCompletionInput): ModelCompletionMessage[] {
  if (input.messages?.length) return [...input.messages];
  if (input.prompt) return [{ role: "user", content: input.prompt }];
  throw new Error("ModelClient completion requires prompt or messages");
}

function transcriptFromMessages(messages: ModelCompletionMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}

function codexPrompt(input: ModelCompletionInput): string {
  if (input.prompt) return input.prompt;
  return transcriptFromMessages(completionMessages(input));
}

function anthropicMessages(input: ModelCompletionInput): {
  system?: string;
  messages: MessageParam[];
} {
  const system: string[] = [];
  const messages: MessageParam[] = [];

  for (const message of completionMessages(input)) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    messages.push({ role: message.role, content: message.content });
  }

  if (!messages.length) {
    messages.push({ role: "user", content: transcriptFromMessages(completionMessages(input)) });
  }

  return {
    ...(system.length ? { system: system.join("\n\n") } : {}),
    messages,
  };
}

function textFromAnthropicContent(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function openAiMessages(input: ModelCompletionInput): ModelCompletionMessage[] {
  return completionMessages(input);
}

export function createAnthropicMessagesModelClient(options: AnthropicMessagesModelClientOptions): ModelClient {
  return withClassification({
    id: options.id,
    kind: "model_client",
    complete: async (input: ModelCompletionInput): Promise<ModelCompletionResult> => {
      const ctrl = timeoutController(input, options.timeoutMs, `Anthropic model client timeout after ${options.timeoutMs}ms`);
      try {
        const client = getAnthropicClient(options);
        const prepared = anthropicMessages(input);
        const msg = await client.messages.create({
          model: input.model ?? options.model,
          max_tokens: input.maxTokens ?? 1024,
          temperature: input.temperature ?? 0,
          ...(prepared.system ? { system: prepared.system } : {}),
          messages: prepared.messages,
        }, { signal: ctrl.signal });
        return {
          text: textFromAnthropicContent(msg.content),
          model: input.model ?? options.model,
          usage: {
            inputTokens: msg.usage?.input_tokens,
            outputTokens: msg.usage?.output_tokens,
            cacheReadTokens: msg.usage?.cache_read_input_tokens ?? undefined,
            cacheCreationTokens: msg.usage?.cache_creation_input_tokens ?? undefined,
          },
          raw: msg,
        };
      } finally {
        if (!ctrl.signal.aborted) ctrl.abort();
      }
    },
  });
}

export function createOpenAiChatModelClient(options: OpenAiChatModelClientOptions): ModelClient {
  return withClassification({
    id: options.id,
    kind: "model_client",
    complete: async (input: ModelCompletionInput): Promise<ModelCompletionResult> => {
      if (options.provider === "openai" && !options.apiKey) {
        throw new Error("OPENAI_API_KEY is required for OpenAI model client");
      }
      if (options.provider === "openai_compatible" && !options.baseUrl) {
        throw new Error("OPENAI_BASE_URL is required for OpenAI-compatible model client");
      }

      const baseUrl = trimBaseUrl(options.baseUrl ?? OPENAI_DEFAULT_BASE_URL);
      const ctrl = timeoutController(input, options.timeoutMs, `OpenAI model client timeout after ${options.timeoutMs}ms`);

      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
        const response = await (options.fetchFn ?? fetch)(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          signal: ctrl.signal,
          body: JSON.stringify({
            model: input.model ?? options.model,
            temperature: input.temperature ?? 0,
            max_tokens: input.maxTokens ?? 1024,
            ...(input.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
            messages: openAiMessages(input),
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI model client HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
        }

        const json = await response.json() as OpenAiChatCompletionResponse;
        const text = json.choices?.[0]?.message?.content;
        if (!text) throw new Error("OpenAI model client response did not contain message content");
        return {
          text,
          model: json.model ?? input.model ?? options.model,
          usage: {
            inputTokens: json.usage?.prompt_tokens,
            outputTokens: json.usage?.completion_tokens,
          },
          raw: json,
        };
      } finally {
        if (!ctrl.signal.aborted) ctrl.abort();
      }
    },
  });
}

export function createCodexThreadModelClient(options: CodexThreadModelClientOptions): ModelClient {
  return withClassification({
    id: options.id,
    kind: "model_client",
    complete: async (input: ModelCompletionInput): Promise<ModelCompletionResult> => {
      const prompt = codexPrompt(input);
      const baseCtrl = new AbortController();
      const forwardAbort = () => baseCtrl.abort(input.signal?.reason ?? new Error("Model client aborted"));
      if (input.signal?.aborted) {
        forwardAbort();
      } else {
        input.signal?.addEventListener("abort", forwardAbort, { once: true });
      }
      const timeoutCtrl = withCodexTimeout(baseCtrl.signal, options.timeoutMs);

      try {
        const threadOptions: ThreadOptions = {
          ...codexThreadOptions("chat", options.cwd),
          sandboxMode: "read-only",
          approvalPolicy: "never",
          webSearchMode: "disabled",
          networkAccessEnabled: false,
        };
        const model = input.model ?? options.model;
        if (model) threadOptions.model = model;
        const thread = (options.getClient ?? getCodexClient)().startThread(threadOptions);
        const { events } = await thread.runStreamed(prompt, { signal: timeoutCtrl.signal });
        let text = "";
        for await (const event of events) {
          if (event.type === "turn.failed") throw new Error(event.error.message);
          if (event.type === "error") throw new Error(event.message);
          if (
            (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") &&
            event.item.type === "agent_message"
          ) {
            text = event.item.text;
          }
        }
        return { text, model };
      } finally {
        input.signal?.removeEventListener("abort", forwardAbort);
        if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();
        if (!baseCtrl.signal.aborted) baseCtrl.abort();
      }
    },
  });
}

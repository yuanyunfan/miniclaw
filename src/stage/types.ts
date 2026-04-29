// 核心类型：Persona / Scene / SceneMessage / AgentStatus
// 全部为 plain data，状态机和路由实现在 orchestrator.ts

export type AgentStatus = "idle" | "thinking" | "speaking" | "tool-call" | "aborted" | "done";

export interface Persona {
  id: string;                    // 文件名（小写），唯一
  name: string;                  // 显示名（CEO / Engineer …）
  emoji: string;                 // 状态栏图标
  systemPrompt: string;          // frontmatter 之后的正文
  model?: string;                // 默认 config.model
  tools?: string[];              // 工具白名单（默认全部 chat-tools）
  budgetPerTurnUsd?: number;     // 单 turn 预算 hint（暂仅记录）
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
}

export interface SceneMessage {
  ts: number;
  speaker: "user" | string;      // string = persona.id
  content: string;
  mentions?: string[];           // 解析出的 @<persona-id>
  toolCalls?: ToolCallRecord[];
  costUsd?: number;
  iters?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type SceneMode = "manual" | "auto";

export interface Scene {
  id: string;
  name?: string;
  startedAt: number;
  endedAt?: number;
  participants: Set<string>;     // persona ids
  registry: Map<string, Persona>;
  messages: SceneMessage[];
  totalCostUsd: number;
  totalTurns: number;
  mode: SceneMode;
  budgetCapUsd: number;
  turnCap: number;
  // 运行时状态
  agentStatus: Map<string, AgentStatus>;
  abortControllers: Map<string, AbortController>;
}

export interface ChatOnceCallbacks {
  onText?: (delta: string) => void;
  onToolCall?: (tc: ToolCallRecord) => void;
  onStatus?: (status: AgentStatus) => void;
}

export interface ChatOnceResult {
  content: string;
  mentions: string[];
  toolCalls: ToolCallRecord[];
  costUsd: number;
  iters: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  aborted: boolean;
}

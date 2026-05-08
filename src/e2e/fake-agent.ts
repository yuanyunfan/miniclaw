import type { AgentProvider } from "../config.js";
import { formatSessionId } from "../agent/session.js";

const RUN_ID_RE = /\be2e(?:[-_\s]+(?:chat|task|followup|attachment|smart|router|real|agent))?[-_\s]+([A-Za-z0-9._-]{3,})\b/gi;

export interface FakeAgentResult {
  reply: string;
  sessionId: string;
  tokensSummary: string;
  durationMs: number;
}

export function extractE2eRunId(prompt: string): string {
  const matches = [...prompt.matchAll(RUN_ID_RE)];
  return matches.at(-1)?.[1] ?? process.env.MINICLAW_E2E_RUN_ID ?? "unknown-run";
}

export function buildFakeChatReply(prompt: string): FakeAgentResult {
  const runId = extractE2eRunId(prompt);
  return {
    reply: `E2E_CHAT_OK ${runId}`,
    sessionId: "",
    tokensSummary: "in=11 out=7 cacheR=0 cacheW=0",
    durationMs: 25,
  };
}

export function buildFakeTaskResult(prompt: string, provider: AgentProvider): FakeAgentResult {
  const runId = extractE2eRunId(prompt);
  return {
    reply: `E2E_TASK_OK ${runId}`,
    sessionId: formatSessionId(provider, `e2e-${runId}`),
    tokensSummary: "in=17 out=9 cacheR=0 cacheW=0",
    durationMs: 50,
  };
}

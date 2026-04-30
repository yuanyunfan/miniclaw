import type { AgentProvider } from "../config.js";

export interface ProviderSessionId {
  provider: AgentProvider;
  id: string;
}

export function formatSessionId(provider: AgentProvider, id: string): string {
  return `${provider}:${id}`;
}

export function parseSessionId(sessionId: string): ProviderSessionId {
  const idx = sessionId.indexOf(":");
  if (idx > 0) {
    const provider = sessionId.slice(0, idx);
    const id = sessionId.slice(idx + 1);
    if ((provider === "claude" || provider === "codex") && id) {
      return { provider, id };
    }
  }

  // Backward compatibility: historical rows stored raw Claude SDK session ids.
  return { provider: "claude", id: sessionId };
}

export function assertProviderSession(sessionId: string, provider: AgentProvider): string {
  const parsed = parseSessionId(sessionId);
  if (parsed.provider !== provider) {
    throw new Error(
      `无法恢复 ${parsed.provider} session：当前 MINICLAW_AGENT_PROVIDER=${provider}。请切回 ${parsed.provider} 或新建任务。`
    );
  }
  return parsed.id;
}

export function displaySessionId(sessionId: string): string {
  if (!sessionId) return "(无)";
  const parsed = parseSessionId(sessionId);
  return `${parsed.provider}:${parsed.id.slice(0, 8)}`;
}

import type { Usage as CodexUsage } from "@openai/codex-sdk";

export function fmtTokens(n?: number): string {
  if (n === undefined || n === null) return "-";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatAnthropicUsage(usage: unknown): string | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const parts: string[] = [];
  if (u.input_tokens !== undefined) parts.push(`in: ${fmtTokens(u.input_tokens)}`);
  if (u.output_tokens !== undefined) parts.push(`out: ${fmtTokens(u.output_tokens)}`);
  if (u.cache_read_input_tokens) parts.push(`cache hit: ${fmtTokens(u.cache_read_input_tokens)}`);
  if (u.cache_creation_input_tokens) parts.push(`cache write: ${fmtTokens(u.cache_creation_input_tokens)}`);
  return parts.length ? parts.join(" · ") : undefined;
}

export function formatCodexUsage(usage?: CodexUsage | null): string | undefined {
  if (!usage) return undefined;
  const parts: string[] = [
    `in: ${fmtTokens(usage.input_tokens)}`,
    `out: ${fmtTokens(usage.output_tokens)}`,
  ];
  if (usage.cached_input_tokens) parts.push(`cache hit: ${fmtTokens(usage.cached_input_tokens)}`);
  if (usage.reasoning_output_tokens) parts.push(`reasoning: ${fmtTokens(usage.reasoning_output_tokens)}`);
  return parts.join(" · ");
}

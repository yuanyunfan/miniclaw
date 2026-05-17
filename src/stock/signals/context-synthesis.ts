import type { StockMarketEvidence, StockMarketMemoryItem, StockMarketMemorySnapshot, StockSignal } from "../types.js";

export interface ContextSynthesisInput {
  marketScope: StockMarketMemorySnapshot["market_scope"];
  tradeDate: string;
  generatedAt: string;
  previousMemory: StockMarketMemorySnapshot[];
  evidence: StockMarketEvidence[];
  signals: StockSignal[];
  maxItems?: number;
}

export interface ContextSynthesisSeed {
  market_scope: StockMarketMemorySnapshot["market_scope"];
  trade_date: string;
  generated_at: string;
  previous_digest_text: string;
  carry_forward_items: StockMarketMemoryItem[];
  new_evidence_summaries: string[];
  signal_summaries: string[];
}

function memoryItemKey(item: StockMarketMemoryItem): string {
  return item.stable_key || `${item.topic}:${item.horizon}`;
}

export function buildContextSynthesisSeed(input: ContextSynthesisInput): ContextSynthesisSeed {
  const maxItems = Math.max(1, Math.min(input.maxItems ?? 40, 120));
  const carried = new Map<string, StockMarketMemoryItem>();
  for (const snapshot of input.previousMemory) {
    for (const item of snapshot.active_items) {
      if (item.status !== "active") continue;
      const key = memoryItemKey(item);
      if (!carried.has(key)) carried.set(key, item);
    }
  }
  return {
    market_scope: input.marketScope,
    trade_date: input.tradeDate,
    generated_at: input.generatedAt,
    previous_digest_text: input.previousMemory
      .map((snapshot) => snapshot.digest_text)
      .filter((text) => text.trim().length > 0)
      .join("\n\n")
      .slice(0, 8000),
    carry_forward_items: [...carried.values()].slice(0, maxItems),
    new_evidence_summaries: input.evidence
      .map((item) => `${item.id}: ${item.summary}`)
      .slice(0, maxItems),
    signal_summaries: input.signals
      .map((signal) => `${signal.id}: ${signal.target} ${signal.severity} - ${signal.rationale}`)
      .slice(0, maxItems),
  };
}

import type { MarketIntelOfficialHttpClient } from "./official-shared.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export class FetchMarketIntelOfficialHttpClient implements MarketIntelOfficialHttpClient {
  async getText(url: string, init: { headers?: Record<string, string> } = {}): Promise<string> {
    const res = await this.request(url, { method: "GET", headers: init.headers });
    return await res.text();
  }

  async getJson(url: string, init: { headers?: Record<string, string> } = {}): Promise<unknown> {
    const res = await this.request(url, { method: "GET", headers: init.headers });
    return await res.json() as unknown;
  }

  async postJson(url: string, body: unknown, init: { headers?: Record<string, string> } = {}): Promise<unknown> {
    const res = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...init.headers },
      body: JSON.stringify(body),
    });
    return await res.json() as unknown;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ac.signal,
        headers: {
          "User-Agent": "MiniClaw/0.4 market-intel",
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}

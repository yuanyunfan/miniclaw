import type { EastmoneyEtfPremiumClient } from "../../data/etf-premium-types.js";

const SELECTOR_ENDPOINT = "https://datacenter.eastmoney.com/stock/fundselector/api/data/get";
const SELECTOR_FIELDS = [
  "SECUCODE",
  "SECURITY_CODE",
  "SECURITY_NAME_ABBR",
  "INDEX_NAME",
  "NEW_PRICE",
  "CHANGE_RATE",
  "VOLUME",
  "DEAL_AMOUNT",
  "PREMIUM_DISCOUNT_RATIO",
  "QUANTITY_RELATIVE_RATIO",
  "HIGH_PRICE",
  "LOW_PRICE",
  "PRE_CLOSE_PRICE",
  "DEC_NAV",
  "DEC_TOTALSHARE",
].join(",");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export class EastmoneyFundSelectorPremiumClient implements EastmoneyEtfPremiumClient {
  async getFundSelectorRow(code: string, timeoutMs: number): Promise<Record<string, unknown> | undefined> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const url = new URL(SELECTOR_ENDPOINT);
      url.searchParams.set("type", "RPTA_APP_FUNDSELECT");
      url.searchParams.set("source", "FUND_SELECTOR");
      url.searchParams.set("client", "APP");
      url.searchParams.set("filter", `(SECURITY_CODE="${code}")`);
      url.searchParams.set("sty", SELECTOR_FIELDS);
      url.searchParams.set("st", "SECURITY_CODE");
      url.searchParams.set("sr", "1");
      url.searchParams.set("p", "1");
      url.searchParams.set("ps", "10");

      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "Mozilla/5.0 MiniClaw/eastmoney-etf-premium",
        },
      });
      if (!res.ok) throw new Error(`Eastmoney fund selector HTTP ${res.status}`);
      const json = await res.json() as unknown;
      if (!isRecord(json)) throw new Error("Eastmoney fund selector returned non-object JSON");
      if (json.success === false) throw new Error(`Eastmoney fund selector failed: ${String(json.message ?? "unknown")}`);
      const result = isRecord(json.result) ? json.result : undefined;
      const data = Array.isArray(result?.data) ? result.data.filter(isRecord) : [];
      return data.find((row) => row.SECURITY_CODE === code) ?? data[0];
    } finally {
      clearTimeout(timer);
    }
  }
}

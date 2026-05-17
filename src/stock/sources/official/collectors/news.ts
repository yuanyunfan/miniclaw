import { parseFederalReserveRssEvidence } from "./parsers/macro.js";
import type { CollectorResult, OfficialCollectorParams } from "./official-shared.js";
import { failureResult, skippedResult, source } from "./official-shared.js";

export async function collectOfficialNewsEvidence(params: OfficialCollectorParams): Promise<CollectorResult[]> {
  return params.config.market_scope === "us"
    ? await Promise.all([collectFed(params)])
    : [];
}

async function collectFed(params: OfficialCollectorParams): Promise<CollectorResult> {
  if (!params.config.sources.macro.federal_reserve) {
    return skippedResult({
      id: "macro.federal_reserve",
      collector: "news",
      sourceName: "federal_reserve",
      message: "Federal Reserve macro/news source is not configured.",
    });
  }
  const url = "https://www.federalreserve.gov/feeds/press_all.xml";
  try {
    const items = parseFederalReserveRssEvidence({
      xmlText: await params.http.getText(url),
      runAt: params.args.runAt,
      maxStaleMinutes: params.config.quality.max_stale_minutes.news,
    });
    return {
      items,
      source: source({
        id: "news.federal_reserve",
        collector: "news",
        source: "official_html_rss",
        tier: "official",
        status: "ok",
        message: `Federal Reserve RSS fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "news.federal_reserve", collector: "news", sourceName: "federal_reserve", err });
  }
}

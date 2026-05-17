import type {
  MarketIntelDataQualitySource,
  MarketIntelEvidenceCollection,
  MarketIntelEvidenceItem,
  MarketIntelProviderConfig,
} from "../../../data/market-intel-types.js";
import { riskKeyword } from "./parsers/risk.js";
import type { CollectorResult } from "./official-shared.js";
import { dedupeEvidence, emptySection, section, source } from "./official-shared.js";
import type { StockProviderRunArgs } from "../../../types.js";

function deriveRiskEvidence(params: {
  runAt: Date;
  evidence: MarketIntelEvidenceItem[];
  sources: MarketIntelDataQualitySource[];
}): CollectorResult {
  const items: MarketIntelEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of params.evidence) {
    const title = item.title ?? item.summary;
    const riskType = riskKeyword(title);
    if (!riskType || seen.has(riskType)) continue;
    seen.add(riskType);
    items.push({
      id: `risk.derived.${items.length + 1}`,
      category: "risk",
      source: "market-intel derived risk flags",
      source_tier: "local_readonly",
      captured_at: params.runAt.toISOString(),
      title: `${riskType} flagged from official evidence`,
      summary: `Derived ${riskType} from ${item.id}: ${item.summary}`,
      published_at: item.published_at,
      importance: item.importance === "high" ? "high" : "medium",
      freshness: item.freshness,
      freshness_minutes: item.freshness_minutes,
      url: item.url,
      symbols: item.symbols,
      sectors: item.sectors,
    });
    if (items.length >= 8) break;
  }

  const failedSources = params.sources.filter((item) => item.status === "failed" || item.status === "missing_config");
  if (failedSources.length) {
    items.push({
      id: `risk.derived.${items.length + 1}`,
      category: "risk",
      source: "market-intel derived risk flags",
      source_tier: "local_readonly",
      captured_at: params.runAt.toISOString(),
      title: "data_quality_risk flagged from source failures",
      summary: `Official source coverage is degraded: ${failedSources.map((item) => item.id).join(", ")}.`,
      importance: "medium",
      freshness: "fresh",
    });
  }

  return {
    items,
    source: source({
      id: "risk.derived",
      collector: "risk",
      source: "derived_from_official_evidence",
      tier: "local_readonly",
      status: "ok",
      message: `Derived risk flags from official evidence: items=${items.length}.`,
    }),
  };
}

export function splitOfficialEvidenceCollection(
  args: StockProviderRunArgs,
  config: MarketIntelProviderConfig,
  results: CollectorResult[],
): MarketIntelEvidenceCollection {
  const sources = results.map((item) => item.source);
  const warnings = results.flatMap((item) => item.warnings ?? []);
  const macroItems = results
    .filter((item) => item.source.collector === "macro" || item.source.id === "news.federal_reserve")
    .flatMap((item) => item.items);
  const newsItems = results
    .filter((item) => item.source.collector === "news" || item.source.id === "macro.pboc" || item.source.id === "macro.nbs")
    .flatMap((item) => item.items);
  const filingItems = results
    .filter((item) => item.source.collector === "filings")
    .flatMap((item) => item.items);
  const earningsItems = filingItems.filter((item) => item.importance === "high" || /10-[QK]|8-K|earnings|annual|quarter/i.test(item.summary));
  const baseEvidence = dedupeEvidence([...macroItems, ...newsItems, ...filingItems]);
  const riskResult = deriveRiskEvidence({ runAt: args.runAt, evidence: baseEvidence, sources });
  const riskItems = riskResult.items;
  const allEvidence = dedupeEvidence([...baseEvidence, ...riskItems]);
  const macroSources = sources.filter((item) => item.collector === "macro" || item.id === "news.federal_reserve");
  const newsSources = sources.filter((item) => item.collector === "news" || item.id === "macro.pboc" || item.id === "macro.nbs");
  const filingSources = sources.filter((item) => item.collector === "filings");
  const riskSources = [riskResult.source];

  return {
    macro_policy: section(macroItems, macroSources, [
      "Official macro/policy sources only. Missing or failed sources are listed in data_quality.",
    ]),
    news: section(newsItems, newsSources, [
      "Generic web search is disabled for structured news. This section includes official RSS/page headlines only.",
    ]),
    earnings: section(earningsItems, filingSources, [
      "No standalone earnings calendar source is enabled. Official filings/announcements are used as catalyst evidence.",
    ]),
    filings: section(filingItems, filingSources, [
      config.market_scope === "us"
        ? "SEC EDGAR submissions are collected for configured US stock symbols only."
        : "SSE, SZSE, and HKEX official announcement searches are collected where their public endpoints are reachable.",
    ]),
    risks: section(riskItems, riskSources, [
      "Risk flags are deterministically derived from official macro/news/filing evidence and source-failure signals.",
    ]),
    evidence: allEvidence,
    data_quality_sources: [...sources, riskResult.source],
    warnings,
  };
}

export function buildEmptyMarketIntelEvidenceCollection(): MarketIntelEvidenceCollection {
  return {
    macro_policy: emptySection("skipped", "Official macro/policy collector was skipped for this run."),
    news: emptySection("skipped", "Official news collector was skipped for this run."),
    earnings: emptySection("skipped", "Earnings collector was skipped for this run."),
    filings: emptySection("skipped", "Filings collector was skipped for this run."),
    risks: emptySection("skipped", "Risk collector was skipped for this run."),
    evidence: [],
    data_quality_sources: [
      source({
        id: "macro.official",
        collector: "macro",
        source: "official_sources",
        tier: "placeholder",
        status: "skipped",
        message: "Official evidence collector was skipped for this run.",
      }),
    ],
    warnings: [],
  };
}

import { XMLParser } from "fast-xml-parser";
import type { MarketIntelEvidenceItem } from "../../../../data/market-intel-types.js";
import {
  asArray,
  dateOnly,
  decodeHtml,
  freshness,
  importanceFromTitle,
  numberValue,
  parseDate,
  recordValue,
  stringValue,
} from "./shared.js";

const XML = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  cdataPropName: "#cdata",
  textNodeName: "#text",
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
});

const BLS_SERIES = [
  { id: "CUUR0000SA0", name: "CPI-U all items", importance: "high" as const },
  { id: "LNS14000000", name: "Unemployment rate", importance: "high" as const },
  { id: "CES0000000001", name: "Nonfarm payroll employment", importance: "medium" as const },
];

export const BLS_SERIES_IDS = BLS_SERIES.map((item) => item.id);

export function parseTreasuryYieldCurveEvidence(params: {
  xmlText: string;
  runAt: Date;
  maxStaleMinutes: number;
  url: string;
}): MarketIntelEvidenceItem[] {
  const parsed = XML.parse(params.xmlText);
  const entries = asArray(recordValue(recordValue(parsed, "feed"), "entry"));
  const rows = entries
    .map((entry) => {
      const props = recordValue(recordValue(entry, "content"), "m:properties");
      const publishedAt = stringValue(recordValue(props, "d:NEW_DATE"))?.slice(0, 10);
      return {
        publishedAt,
        twoYear: numberValue(recordValue(props, "d:BC_2YEAR")),
        tenYear: numberValue(recordValue(props, "d:BC_10YEAR")),
        thirtyYear: numberValue(recordValue(props, "d:BC_30YEAR")),
      };
    })
    .filter((row) => row.publishedAt && parseDate(row.publishedAt) !== undefined)
    .sort((a, b) => (parseDate(b.publishedAt) ?? 0) - (parseDate(a.publishedAt) ?? 0));
  const runDate = dateOnly(params.runAt);
  const row = rows.find((item) => item.publishedAt !== undefined && item.publishedAt <= runDate) ?? rows[0];
  return row
    ? [{
      id: "macro.treasury.yield_curve.1",
      category: "macro",
      source: "U.S. Treasury daily treasury yield curve",
      source_tier: "official",
      captured_at: params.runAt.toISOString(),
      title: "U.S. Treasury yield curve",
      summary: `Treasury yield curve ${row.publishedAt}: 2Y=${row.twoYear ?? "n/a"}%, 10Y=${row.tenYear ?? "n/a"}%, 30Y=${row.thirtyYear ?? "n/a"}%.`,
      published_at: row.publishedAt,
      importance: "high",
      ...freshness(params.runAt, row.publishedAt, params.maxStaleMinutes),
      url: params.url,
    }]
    : [];
}

export function parseBlsEvidence(params: {
  json: unknown;
  runAt: Date;
  url: string;
}): MarketIntelEvidenceItem[] {
  const seriesRows = asArray(recordValue(recordValue(params.json, "Results"), "series"));
  return BLS_SERIES.flatMap((series, index): MarketIntelEvidenceItem[] => {
    const row = seriesRows.find((item) => recordValue(item, "seriesID") === series.id);
    const data = asArray(recordValue(row, "data"));
    const latest = data.find((item) => stringValue(recordValue(item, "value")) && stringValue(recordValue(item, "value")) !== "-");
    if (!latest) return [];
    const year = stringValue(recordValue(latest, "year"));
    const periodName = stringValue(recordValue(latest, "periodName"));
    const value = stringValue(recordValue(latest, "value"));
    const publishedAt = year && periodName ? `${periodName} ${year}` : undefined;
    return [{
      id: `macro.bls.${index + 1}`,
      category: "macro",
      source: "BLS Public Data API",
      source_tier: "official",
      captured_at: params.runAt.toISOString(),
      title: `${series.name} latest value`,
      summary: `${series.name}: ${value ?? "n/a"}${publishedAt ? ` for ${publishedAt}` : ""}.`,
      published_at: publishedAt,
      importance: series.importance,
      freshness: "unknown",
      url: params.url,
    }];
  });
}

export function parseFederalReserveRssEvidence(params: {
  xmlText: string;
  runAt: Date;
  maxStaleMinutes: number;
  maxItems?: number;
}): MarketIntelEvidenceItem[] {
  const parsed = XML.parse(params.xmlText);
  const channel = recordValue(recordValue(parsed, "rss"), "channel");
  const entries = asArray(recordValue(channel, "item")).slice(0, params.maxItems ?? 8);
  return entries.flatMap((entry, index): MarketIntelEvidenceItem[] => {
    const title = decodeHtml(stringValue(recordValue(entry, "title")) ?? "");
    if (!title) return [];
    const publishedAt = stringValue(recordValue(entry, "pubDate"));
    return [{
      id: `news.federal_reserve.${index + 1}`,
      category: "news",
      source: "Federal Reserve press RSS",
      source_tier: "official",
      captured_at: params.runAt.toISOString(),
      title,
      summary: `${title}${publishedAt ? ` (${publishedAt})` : ""}`,
      published_at: publishedAt,
      importance: importanceFromTitle(title),
      ...freshness(params.runAt, publishedAt, params.maxStaleMinutes),
      url: stringValue(recordValue(entry, "link")),
    }];
  });
}

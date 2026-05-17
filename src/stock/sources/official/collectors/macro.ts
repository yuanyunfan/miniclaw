import {
  addDays,
  dateOnly,
  extractDatedHtmlLinks,
} from "./parsers/shared.js";
import {
  BLS_SERIES_IDS,
  parseBlsEvidence,
  parseTreasuryYieldCurveEvidence,
} from "./parsers/macro.js";
import type { CollectorResult, OfficialCollectorParams } from "./official-shared.js";
import { failureResult, skippedResult, source } from "./official-shared.js";

export async function collectOfficialMacroEvidence(params: OfficialCollectorParams): Promise<CollectorResult[]> {
  return params.config.market_scope === "us"
    ? await Promise.all([
      collectTreasury(params),
      collectBls(params),
    ])
    : await Promise.all([
      collectPbc(params),
      collectNbs(params),
    ]);
}

async function collectTreasury(params: OfficialCollectorParams): Promise<CollectorResult> {
  if (!params.config.sources.macro.treasury) {
    return skippedResult({
      id: "macro.treasury",
      collector: "macro",
      sourceName: "treasury",
      message: "Treasury macro source is not configured.",
    });
  }
  const year = params.args.runAt.getUTCFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  try {
    const items = parseTreasuryYieldCurveEvidence({
      xmlText: await params.http.getText(url),
      runAt: params.args.runAt,
      maxStaleMinutes: params.config.quality.max_stale_minutes.macro,
      url,
    });
    return {
      items,
      source: source({
        id: "macro.treasury",
        collector: "macro",
        source: "official_xml_or_fiscaldata",
        tier: "official",
        status: "ok",
        message: `Treasury yield curve fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.treasury", collector: "macro", sourceName: "treasury", err });
  }
}

async function collectBls(params: OfficialCollectorParams): Promise<CollectorResult> {
  if (!params.config.sources.macro.bls) {
    return skippedResult({
      id: "macro.bls",
      collector: "macro",
      sourceName: "bls_public_api",
      message: "BLS macro source is not configured.",
    });
  }
  const endYear = params.args.runAt.getUTCFullYear();
  const url = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
  try {
    const json = await params.http.postJson(url, {
      seriesid: BLS_SERIES_IDS,
      startyear: String(endYear - 1),
      endyear: String(endYear),
    });
    const items = parseBlsEvidence({ json, runAt: params.args.runAt, url });
    return {
      items,
      source: source({
        id: "macro.bls",
        collector: "macro",
        source: "official_public_api",
        tier: "official",
        status: "ok",
        message: `BLS public API fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.bls", collector: "macro", sourceName: "bls_public_api", err });
  }
}

async function collectPbc(params: OfficialCollectorParams): Promise<CollectorResult> {
  if (!params.config.sources.macro.pboc) {
    return skippedResult({
      id: "macro.pboc",
      collector: "macro",
      sourceName: "pboc",
      message: "PBOC macro source is not configured.",
    });
  }
  const url = "http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html";
  try {
    const items = extractDatedHtmlLinks({
      html: await params.http.getText(url),
      baseUrl: url,
      idPrefix: "macro.pboc.omo",
      source: "PBOC open market operations page",
      category: "macro",
      runAt: params.args.runAt,
      maxItems: 8,
      maxStaleMinutes: params.config.quality.max_stale_minutes.macro,
      importance: "high",
    });
    return {
      items,
      source: source({
        id: "macro.pboc",
        collector: "macro",
        source: "official_html",
        tier: "official",
        status: "ok",
        message: `PBOC open market operations page fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.pboc", collector: "macro", sourceName: "pboc", err });
  }
}

async function collectNbs(params: OfficialCollectorParams): Promise<CollectorResult> {
  if (!params.config.sources.macro.nbs) {
    return skippedResult({
      id: "macro.nbs",
      collector: "macro",
      sourceName: "nbs",
      message: "NBS macro source is not configured.",
    });
  }
  const url = "https://www.stats.gov.cn/english/PressRelease/";
  try {
    const items = extractDatedHtmlLinks({
      html: await params.http.getText(url),
      baseUrl: url,
      idPrefix: "macro.nbs.release",
      source: "NBS latest releases page",
      category: "macro",
      runAt: params.args.runAt,
      maxItems: 12,
      maxStaleMinutes: params.config.quality.max_stale_minutes.macro,
    });
    return {
      items,
      source: source({
        id: "macro.nbs",
        collector: "macro",
        source: "official_html",
        tier: "official",
        status: "ok",
        message: `NBS latest releases page fetched: items=${items.length}.`,
      }),
    };
  } catch (err) {
    return failureResult({ id: "macro.nbs", collector: "macro", sourceName: "nbs", err });
  }
}

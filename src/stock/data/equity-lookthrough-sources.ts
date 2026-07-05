import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type {
  StockPortfolioEquityLookthroughAliasConfig,
  StockPortfolioEquityLookthroughColumnConfig,
  StockPortfolioEquityLookthroughConstituentConfig,
  StockPortfolioEquityLookthroughDataSourceConfig,
  StockPortfolioEquityLookthroughSourceConfig,
  StockPortfolioProviderConfig,
} from "./portfolio-types.js";

const DEFAULT_USER_AGENT = "MiniClaw/1.0 stock-portfolio";
const LOOKTHROUGH_FETCH_MAX_ATTEMPTS = 3;
const LOOKTHROUGH_FETCH_RETRY_DELAY_MS = 250;
const LOOKTHROUGH_SOURCE_CONCURRENCY = 4;
const SOFFICE_TIMEOUT_MS = 30000;
const execFileAsync = promisify(execFile);
const SOFFICE_COMMANDS = [
  process.env.LIBREOFFICE_PATH,
  process.env.SOFFICE_PATH,
  "soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
].filter((item): item is string => Boolean(item?.trim()));

let sofficeCommandPromise: Promise<string> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[%,$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function safeMessage(err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
  const raw = err instanceof Error ? `${err.message}${cause}` : String(err);
  return raw
    .replace(/([A-Za-z0-9+/=_-]{48,})/g, "[redacted]")
    .slice(0, 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveSofficeCommand(): Promise<string> {
  if (!sofficeCommandPromise) {
    sofficeCommandPromise = (async () => {
      for (const command of SOFFICE_COMMANDS) {
        try {
          await execFileAsync(command, ["--version"], { timeout: 5000 });
          return command;
        } catch {
          // Try the next common LibreOffice binary path.
        }
      }
      throw new Error("LibreOffice soffice command not found for http_xls source conversion");
    })();
  }
  return sofficeCommandPromise;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeCodeToken(code: string): string {
  return code.trim().toUpperCase()
    .replace(/^US\./, "")
    .replace(/^HK\./, "")
    .replace(/^SH\./, "")
    .replace(/^SZ\./, "")
    .replace(/\.SS$/, "")
    .replace(/\.SZ$/, "");
}

function codeTokens(code: string): string[] {
  return code
    .split(/[，,;/|]/)
    .map(normalizeCodeToken)
    .filter(Boolean);
}

function findField(row: Record<string, unknown>, names: string[]): unknown {
  const direct = names.find((name) => Object.hasOwn(row, name));
  if (direct) return row[direct];
  const normalized = new Map(Object.keys(row).map((key) => [key.trim().toLowerCase(), key]));
  const matched = names.map((name) => normalized.get(name.trim().toLowerCase())).find(Boolean);
  return matched ? row[matched] : undefined;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "nbsp") return " ";
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    if (lower.startsWith("#x")) {
      const value = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    if (lower.startsWith("#")) {
      const value = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return match;
  });
}

function stripHtml(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeJsString(raw: string): string {
  try {
    return JSON.parse(`"${raw.replace(/\r?\n/g, "\\n")}"`) as string;
  } catch {
    return raw
      .replace(/\\"/g, "\"")
      .replace(/\\\//g, "/")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
}

function extractEastmoneyFundContent(text: string): string {
  const matched = /content:"((?:\\.|[^"\\])*)"/.exec(text);
  return matched ? decodeJsString(matched[1] ?? "") : "";
}

function htmlCells(rowHtml: string, tagName: "td" | "th"): string[] {
  const cells: string[] = [];
  const cellRegex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  for (const match of rowHtml.matchAll(cellRegex)) {
    cells.push(stripHtml(match[1] ?? ""));
  }
  return cells;
}

function normalizedHeader(value: string): string {
  return value.replace(/\s+/g, "");
}

function findColumnIndex(headers: string[], pattern: RegExp, fallback: number): number {
  const index = headers.findIndex((header) => pattern.test(normalizedHeader(header)));
  return index >= 0 ? index : fallback;
}

function parseEastmoneyFundHoldings(text: string): Record<string, unknown>[] {
  const content = extractEastmoneyFundContent(text);
  if (!content.trim()) return [];

  const rows: Record<string, unknown>[] = [];
  let headers: string[] = [];
  for (const rowMatch of content.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] ?? "";
    const headerCells = htmlCells(rowHtml, "th");
    if (headerCells.length) {
      headers = headerCells;
      continue;
    }

    const dataCells = htmlCells(rowHtml, "td");
    if (dataCells.length < 3) continue;
    const codeIndex = findColumnIndex(headers, /股票代码/, 1);
    const companyIndex = findColumnIndex(headers, /股票名称/, 2);
    const weightIndex = findColumnIndex(headers, /占净值/, 6);
    const code = dataCells[codeIndex];
    const company = dataCells[companyIndex];
    const weight = dataCells[weightIndex];
    if (!code || !company || !weight) continue;
    rows.push({
      "股票代码": code,
      "股票名称": company,
      "占净值比例": weight,
    });
  }

  return rows;
}

function rowsToObjects(rows: string[][], columns: StockPortfolioEquityLookthroughColumnConfig): Record<string, unknown>[] {
  const required = [...columns.company, ...columns.code, ...columns.weight_pct].map((item) => item.trim().toLowerCase());
  const headerIndex = rows.findIndex((row) => {
    const values = new Set(row.map((cell) => cell.trim().toLowerCase()));
    return required.some((name) => values.has(name));
  });
  if (headerIndex === -1) throw new Error("holdings table header row was not found");
  const headers = rows[headerIndex].map((cell) => cell.trim());
  return rows.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function cellText(value: unknown, sharedStrings: string[]): string {
  if (!isRecord(value)) return "";
  const raw = value.v;
  if (value["@_t"] === "s") return sharedStrings[Number(raw)] ?? "";
  return raw === undefined || raw === null ? "" : String(raw);
}

function richTextToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  if (typeof value.t === "string") return value.t;
  if (Array.isArray(value.r)) return value.r.map((item) => isRecord(item) ? str(item.t) ?? "" : "").join("");
  return str(value["#text"]) ?? "";
}

function parseXlsx(buffer: Uint8Array, columns: StockPortfolioEquityLookthroughColumnConfig): Record<string, unknown>[] {
  const zip = unzipSync(buffer);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const sharedXml = zip["xl/sharedStrings.xml"] ? strFromU8(zip["xl/sharedStrings.xml"]) : "";
  const sharedRaw = sharedXml ? parser.parse(sharedXml).sst?.si : [];
  const sharedRows = Array.isArray(sharedRaw) ? sharedRaw : sharedRaw ? [sharedRaw] : [];
  const sharedStrings = sharedRows.map(richTextToString);
  const sheetName = Object.keys(zip).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("xlsx workbook has no worksheet XML");
  const sheet = parser.parse(strFromU8(zip[sheetName])).worksheet?.sheetData?.row;
  const rawRows = Array.isArray(sheet) ? sheet : sheet ? [sheet] : [];
  const rows = rawRows.map((row) => {
    const cells = Array.isArray(row.c) ? row.c : row.c ? [row.c] : [];
    return cells.map((cell: unknown) => cellText(cell, sharedStrings));
  });
  return rowsToObjects(rows, columns);
}

async function parseXls(buffer: Uint8Array, columns: StockPortfolioEquityLookthroughColumnConfig): Promise<Record<string, unknown>[]> {
  const soffice = await resolveSofficeCommand();
  const dir = await mkdtemp(join(tmpdir(), "miniclaw-lookthrough-xls-"));
  try {
    const inputPath = join(dir, "source.xls");
    const profilePath = join(dir, "lo-profile");
    await mkdir(profilePath);
    await writeFile(inputPath, buffer);
    await execFileAsync(
      soffice,
      [`-env:UserInstallation=${pathToFileURL(profilePath).href}`, "--headless", "--convert-to", "csv", "--outdir", dir, inputPath],
      { timeout: SOFFICE_TIMEOUT_MS },
    );
    const csvName = (await readdir(dir)).find((name) => name.toLowerCase().endsWith(".csv"));
    if (!csvName) throw new Error("LibreOffice did not create a CSV file from xls workbook");
    const csv = await readFile(join(dir, csvName), "utf8");
    return rowsToObjects(parseCsv(csv), columns);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function itemsAtPath(json: unknown, path: string | undefined): unknown[] {
  if (!path) return Array.isArray(json) ? json : [];
  const value = path.split(".").filter(Boolean).reduce((current: unknown, part) => {
    if (Array.isArray(current)) {
      const index = Number(part);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    return isRecord(current) ? current[part] : undefined;
  }, json);
  return Array.isArray(value) ? value : [];
}

function aliasForCode(
  code: string,
  aliases: StockPortfolioEquityLookthroughAliasConfig[],
): StockPortfolioEquityLookthroughAliasConfig | undefined {
  const holdingCodes = new Set(codeTokens(code));
  return aliases.find((alias) => [alias.code, ...alias.aliases].some((item) => codeTokens(item).some((token) => holdingCodes.has(token))));
}

function rowToConstituent(
  row: Record<string, unknown>,
  source: StockPortfolioEquityLookthroughSourceConfig,
): StockPortfolioEquityLookthroughConstituentConfig | undefined {
  if (!source.data_source) return undefined;
  const company = str(findField(row, source.data_source.columns.company));
  const code = str(findField(row, source.data_source.columns.code));
  const weightPct = num(findField(row, source.data_source.columns.weight_pct));
  if (!company || !code || weightPct === undefined || weightPct <= 0) return undefined;
  const alias = aliasForCode(code, source.company_aliases);
  return {
    company_key: alias?.company_key,
    company: alias?.company ?? company,
    code: alias?.code ?? code,
    aliases: alias?.aliases ?? [],
    weight_pct: weightPct,
  };
}

async function fetchBytesOnce(source: StockPortfolioEquityLookthroughDataSourceConfig): Promise<Uint8Array> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), source.timeout_ms);
  try {
    const res = await fetch(source.url, {
      signal: ac.signal,
      headers: { "User-Agent": source.user_agent ?? DEFAULT_USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(source: StockPortfolioEquityLookthroughDataSourceConfig): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LOOKTHROUGH_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchBytesOnce(source);
    } catch (err) {
      lastError = err;
      if (attempt < LOOKTHROUGH_FETCH_MAX_ATTEMPTS) {
        await sleep(LOOKTHROUGH_FETCH_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw new Error(`${safeMessage(lastError)} after ${LOOKTHROUGH_FETCH_MAX_ATTEMPTS} attempts`);
}

async function fetchRows(source: StockPortfolioEquityLookthroughSourceConfig): Promise<Record<string, unknown>[]> {
  const dataSource = source.data_source;
  if (!dataSource) return [];
  const bytes = await fetchBytes(dataSource);
  if (dataSource.type === "eastmoney_fund_holdings") {
    return parseEastmoneyFundHoldings(Buffer.from(bytes).toString("utf8"));
  }
  if (dataSource.type === "http_json") {
    const json = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    return itemsAtPath(json, dataSource.items_path).filter(isRecord);
  }
  if (dataSource.type === "http_xlsx") {
    return parseXlsx(bytes, dataSource.columns);
  }
  if (dataSource.type === "http_xls") {
    return await parseXls(bytes, dataSource.columns);
  }
  const text = Buffer.from(bytes).toString("utf8");
  if (/^\s*<!doctype html|^\s*<html/i.test(text)) throw new Error("HTTP source returned HTML instead of CSV");
  return rowsToObjects(parseCsv(text), dataSource.columns);
}

export interface ResolvedEquityLookthroughSources {
  config: StockPortfolioProviderConfig;
  warnings: string[];
}

export async function resolveEquityLookthroughSources(config: StockPortfolioProviderConfig): Promise<ResolvedEquityLookthroughSources> {
  if (!config.include_equity_lookthrough_summary || !config.equity_lookthrough_sources.length) {
    return { config, warnings: [] };
  }

  const warnings: string[] = [];
  const sources = await mapWithConcurrency(config.equity_lookthrough_sources, LOOKTHROUGH_SOURCE_CONCURRENCY, async (source) => {
    if (!source.data_source) return source;
    try {
      const rows = await fetchRows(source);
      const constituents = rows
        .map((row) => rowToConstituent(row, source))
        .filter((item): item is StockPortfolioEquityLookthroughConstituentConfig => item !== undefined);
      if (!constituents.length) {
        warnings.push(`${source.label} look-through source returned no usable constituent rows`);
        return { ...source, constituents: [] };
      }
      return { ...source, constituents };
    } catch (err) {
      warnings.push(`${source.label} look-through source failed: ${safeMessage(err)}`);
      return { ...source, constituents: [] };
    }
  });

  return {
    config: { ...config, equity_lookthrough_sources: sources },
    warnings,
  };
}

export const __testables = {
  mapWithConcurrency,
  parseEastmoneyFundHoldings,
  parseCsv,
  parseXls,
  parseXlsx,
  rowsToObjects,
};

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  StockPortfolioEquityLookthroughRow,
  StockPortfolioEquityLookthroughSummary,
} from "../data/portfolio-types.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(value: number): string {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(value: number | undefined): string {
  return value === undefined ? "-" : `${value.toFixed(2)}%`;
}

function charUnits(char: string): number {
  return /[\u4e00-\u9fff]/.test(char) ? 2 : 1;
}

function textUnits(text: string): number {
  return [...text].reduce((sum, char) => sum + charUnits(char), 0);
}

function wrapText(text: string, maxUnits: number): string[] {
  const words = text.includes(" ")
    ? text.split(/\s+/).filter(Boolean)
    : /[^\x00-\x7F]/.test(text)
      ? [...text]
      : [text];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textUnits(candidate) <= maxUnits) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (textUnits(word) <= maxUnits) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const char of [...word]) {
      if (textUnits(`${chunk}${char}`) > maxUnits && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function rowLineCount(row: StockPortfolioEquityLookthroughRow): number {
  return Math.max(
    wrapText(row.company, 22).length,
    wrapText(row.code, 16).length,
    wrapText(row.source_labels.join(" + "), 34).length,
  );
}

function textBlock(params: {
  x: number;
  y: number;
  lines: string[];
  maxLines?: number;
  className?: string;
  anchor?: "start" | "middle" | "end";
}): string {
  const maxLines = params.maxLines ?? params.lines.length;
  const lines = params.lines.slice(0, maxLines);
  if (params.lines.length > maxLines && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/, "")}…`;
  }
  const className = params.className ?? "cell";
  const anchor = params.anchor ?? "start";
  return [
    `<text x="${params.x}" y="${params.y}" text-anchor="${anchor}" class="${className}">`,
    ...lines.map((line, index) => `<tspan x="${params.x}" dy="${index === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`),
    "</text>",
  ].join("");
}

export function renderEquityLookthroughChartSvg(summary: StockPortfolioEquityLookthroughSummary): string {
  const rows = summary.rows;
  const width = 2200;
  const left = 70;
  const top = 170;
  const headerHeight = 58;
  const rowPaddingY = 25;
  const lineHeight = 34;
  const rowHeights = rows.map((row) => Math.max(72, rowLineCount(row) * lineHeight + rowPaddingY * 2));
  const height = top + headerHeight + rowHeights.reduce((sum, value) => sum + value, 0) + 80;
  const columns = {
    rank: left + 35,
    company: left + 135,
    code: left + 610,
    amount: left + 900,
    totalPct: left + 1180,
    stockPct: left + 1430,
    sources: left + 1620,
  };
  const coverage = summary.expanded_stock_position_percentage === undefined
    ? "覆盖率: -"
    : `已展开股票仓位: ${summary.expanded_stock_position_percentage.toFixed(2)}%`;
  const subtitle = [
    `股票仓位 ${formatMoney(summary.stock_position_cny)}`,
    `已展开金额 ${formatMoney(summary.expanded_amount_cny)}`,
    coverage,
  ].join("   ");

  let y = top + headerHeight;
  const body: string[] = [];
  for (const [index, row] of rows.entries()) {
    const rowHeight = rowHeights[index];
    const midY = y + rowPaddingY + 24;
    body.push(`<rect x="${left}" y="${y}" width="${width - left * 2}" height="${rowHeight}" fill="${index % 2 === 0 ? "#ffffff" : "#f7f9fc"}"/>`);
    body.push(`<line x1="${left}" y1="${y + rowHeight}" x2="${width - left}" y2="${y + rowHeight}" stroke="#d5dbe5" stroke-width="1"/>`);
    body.push(textBlock({ x: columns.rank, y: midY, lines: [String(row.rank)], anchor: "middle" }));
    body.push(textBlock({ x: columns.company, y: midY, lines: wrapText(row.company, 22), maxLines: 3 }));
    body.push(textBlock({ x: columns.code, y: midY, lines: wrapText(row.code, 16), maxLines: 3 }));
    body.push(textBlock({ x: columns.amount, y: midY, lines: [formatMoney(row.lookthrough_amount_cny)], anchor: "end" }));
    body.push(textBlock({ x: columns.totalPct, y: midY, lines: [formatPct(row.percentage_of_total_assets_cny)], anchor: "end" }));
    body.push(textBlock({ x: columns.stockPct, y: midY, lines: [formatPct(row.percentage_of_stock_position_cny)], anchor: "end" }));
    body.push(textBlock({ x: columns.sources, y: midY, lines: wrapText(row.source_labels.join(" + "), 34), maxLines: 3 }));
    y += rowHeight;
  }

  return `
<svg id="chart" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
      letter-spacing: 0;
    }
    .title { font-size: 42px; font-weight: 800; fill: #1e293b; }
    .subtitle { font-size: 24px; font-weight: 600; fill: #526071; }
    .header { font-size: 23px; font-weight: 800; fill: #f8fafc; }
    .cell { font-size: 24px; font-weight: 650; fill: #1f2937; }
  </style>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${left}" y="72" class="title">整体个股穿透持仓 Top ${summary.top_limit}</text>
  <text x="${left}" y="118" class="subtitle">${escapeXml(subtitle)}</text>
  <rect x="${left}" y="${top}" width="${width - left * 2}" height="${headerHeight}" rx="0" fill="#243447"/>
  <text x="${columns.rank}" y="${top + 38}" text-anchor="middle" class="header">排名</text>
  <text x="${columns.company}" y="${top + 38}" class="header">公司/个股</text>
  <text x="${columns.code}" y="${top + 38}" class="header">代码</text>
  <text x="${columns.amount}" y="${top + 38}" text-anchor="end" class="header">穿透金额</text>
  <text x="${columns.totalPct}" y="${top + 38}" text-anchor="end" class="header">占总资产</text>
  <text x="${columns.stockPct}" y="${top + 38}" text-anchor="end" class="header">占股票仓位</text>
  <text x="${columns.sources}" y="${top + 38}" class="header">主要来源</text>
  ${body.join("\n  ")}
</svg>`;
}

export async function renderEquityLookthroughChartPng(
  summary: StockPortfolioEquityLookthroughSummary,
  params: { profile: string; generatedAt: Date; outputDir?: string },
): Promise<string> {
  const outputDir = params.outputDir ?? join(homedir(), ".miniclaw/runtime/charts");
  mkdirSync(outputDir, { recursive: true });
  const stamp = params.generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const path = join(outputDir, `stock-portfolio-${params.profile}-${stamp}-equity-lookthrough.png`);
  const svg = renderEquityLookthroughChartSvg(summary);
  const html = `<!doctype html><html><head><meta charset="utf-8"/></head><body style="margin:0;background:#fff">${svg}</body></html>`;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2200, height: Math.min(4200, Math.max(900, summary.rows.length * 120 + 260)) }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.locator("#chart").screenshot({ path });
    return path;
  } finally {
    await browser.close();
  }
}

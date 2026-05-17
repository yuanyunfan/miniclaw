import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StockPortfolioAssetSummary, StockPortfolioClassifiableHolding } from "../data/portfolio-types.js";

export interface StockPortfolioPieSlice {
  label: string;
  value: number;
  percentage: number;
  color: string;
}

export interface StockPortfolioPieChartModel {
  title: string;
  total_cny: number;
  slices: StockPortfolioPieSlice[];
}

const LABEL_ORDER = [
  "长债",
  "政金债",
  "信用债",
  "短债",
  "债券",
  "国内股票",
  "海外股票",
  "黄金",
  "现金",
  "未展开资产",
];

const COLORS: Record<string, string> = {
  长债: "#3a76c9",
  政金债: "#ff7a00",
  信用债: "#a8a8a8",
  短债: "#8f8f8f",
  债券: "#2f66b5",
  国内股票: "#d4aa00",
  海外股票: "#49a2d8",
  黄金: "#55b431",
  现金: "#1f4e83",
  未展开资产: "#777777",
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function textOf(holding: StockPortfolioClassifiableHolding): string {
  return `${holding.code} ${holding.name} ${holding.instrument_type ?? ""}`.toUpperCase();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isOverseasEquityExposure(text: string): boolean {
  return hasAny(text, [
    /纳斯达克|纳指|NASDAQ|标普|S&P|SP500|道琼|DOW|MSCI|RUSSELL|罗素|日经|NIKKEI|德国|法国|欧洲|印度/,
    /英伟达|微软|苹果|台积电|伯克希尔|NVIDIA|MICROSOFT|APPLE|TSM|BERKSHIRE/,
    /\bUS\.|\bQQQ\b|\bSPY\b|\bVOO\b|\bIVV\b|\bDIA\b|\bVTI\b|\bVT\b|\bIWM\b|\bEFA\b|\bEEM\b/,
    /\bAAPL\b|\bMSFT\b|\bNVDA\b|\bTSM\b|\bBRK\.B\b/,
  ]);
}

function isDomesticEquityExposure(text: string): boolean {
  return hasAny(text, [
    /沪深|中证|上证|深证|创业板|科创|恒生|国企|A50|CSI|HSI|HSTECH|HANG SENG|盈富|TRACKER FUND/,
    /银行|红利|机器人|港股|创新药|小米|HS300/,
    /\b510300\b|\b510310\b|\b510500\b|\b512800\b|\b515080\b|\b159919\b|\b159915\b|\b159920\b|\b159338\b|\b159530\b|\b588000\b|\b588080\b/,
    /\bHK\.02800\b|\bHK\.02828\b|\bHK\.03033\b|\bHK\.01810\b/,
  ]);
}

export function classifyPieHolding(holding: StockPortfolioClassifiableHolding): string {
  const text = textOf(holding);
  if (holding.code === "UNCLASSIFIED" || holding.instrument_type === "unclassified_asset_gap") return "未展开资产";

  if (hasAny(text, [
    /黄金|GOLD|GLD|IAU|SGOL/,
    /\b518880\b|\b518800\b|\b159934\b|\b159937\b/,
  ])) return "黄金";

  if (hasAny(text, [/债|BOND|TREASURY|GOVT|国债|政金债|信用债|可转债|城投|中债|\bTLT\b|\bIEF\b|\bSHY\b|\bBND\b|\bAGG\b|\bLQD\b|\bHYG\b/])) {
    if (hasAny(text, [/政金|政策性金融|国开|农发|进出/])) return "政金债";
    if (hasAny(text, [/信用债|公司债|企业债|城投|产业债|可转债|转债|\bLQD\b|\bHYG\b/])) return "信用债";
    if (hasAny(text, [/短债|短期|短融|同业存单|\bSHY\b|\b0-3\b|\b1-3\b/])) return "短债";
    if (hasAny(text, [/长债|长期|30年|三十年|20年|二十年|10年|十年|\bTLT\b|\bIEF\b|国债|TREASURY|GOVT|中债/])) return "长债";
    return "债券";
  }

  if (isOverseasEquityExposure(text)) return "海外股票";
  if (isDomesticEquityExposure(text)) return "国内股票";

  if (holding.instrument_type === "stock") {
    return isOverseasEquityExposure(text) ? "海外股票" : "国内股票";
  }

  if (holding.instrument_type === "etf") return isOverseasEquityExposure(text) ? "海外股票" : "国内股票";
  return isOverseasEquityExposure(text) ? "海外股票" : "国内股票";
}

function labelRank(label: string): number {
  const index = LABEL_ORDER.indexOf(label);
  return index === -1 ? LABEL_ORDER.length : index;
}

function sumCash(summary: StockPortfolioAssetSummary): number {
  const cashByCategory = summary.by_category.find((row) => row.category === "cash")?.market_value_cny;
  return roundMoney(summary.cash_cny ?? cashByCategory ?? 0);
}

export function buildAssetPieChartModel(
  summary: StockPortfolioAssetSummary,
  title = "持仓一级分类",
): StockPortfolioPieChartModel | undefined {
  const totals = new Map<string, number>();

  for (const holding of summary.holdings_for_classification) {
    if (!Number.isFinite(holding.market_value_cny) || holding.market_value_cny <= 0) continue;
    const label = classifyPieHolding(holding);
    totals.set(label, roundMoney((totals.get(label) ?? 0) + holding.market_value_cny));
  }

  const cash = sumCash(summary);
  if (cash > 0) totals.set("现金", roundMoney((totals.get("现金") ?? 0) + cash));

  const total = roundMoney([...totals.values()].reduce((sum, value) => sum + value, 0));
  if (total <= 0) return undefined;

  const slices = [...totals.entries()]
    .map(([label, value]) => ({
      label,
      value: roundMoney(value),
      percentage: Math.round((value / total) * 100),
      color: COLORS[label] ?? COLORS["未展开资产"],
    }))
    .sort((a, b) => labelRank(a.label) - labelRank(b.label) || b.value - a.value);

  return { title, total_cny: total, slices };
}

function polar(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polar(cx, cy, radius, startAngle);
  const end = polar(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface SvgLabel {
  x: number;
  y: number;
  anchor: string;
  color: string;
  label: string;
  percentage: number;
  side: "left" | "right" | "middle";
}

function avoidLabelCollisions(labels: SvgLabel[]): void {
  const minGap = 86;
  const minY = 70;
  const maxY = 1210;
  for (const side of ["left", "right"] as const) {
    const group = labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y);
    let previousY = minY - minGap;
    for (const label of group) {
      label.y = Math.max(label.y, previousY + minGap, minY);
      previousY = label.y;
    }
    for (let index = group.length - 1; index >= 0; index--) {
      const next = group[index + 1];
      const label = group[index];
      label.y = Math.min(label.y, next ? next.y - minGap : maxY);
    }
  }
}

export function renderAssetPieChartSvg(model: StockPortfolioPieChartModel): string {
  const width = 1600;
  const height = 1300;
  const cx = 780;
  const cy = 650;
  const radius = 460;
  const labelRadius = 590;
  let angle = -90;

  const paths: string[] = [];
  const labelItems: SvgLabel[] = [];
  for (const slice of model.slices) {
    const sweep = (slice.value / model.total_cny) * 360;
    const start = angle;
    const end = angle + sweep;
    const mid = start + sweep / 2;
    paths.push(`<path d="${arcPath(cx, cy, radius, start, end)}" fill="${slice.color}"/>`);

    const labelPos = polar(cx, cy, labelRadius, mid);
    const anchor = Math.abs(Math.cos((mid * Math.PI) / 180)) < 0.15 ? "middle" : labelPos.x > cx ? "start" : "end";
    labelItems.push({
      x: labelPos.x,
      y: labelPos.y,
      anchor,
      color: slice.color,
      label: slice.label,
      percentage: slice.percentage,
      side: labelPos.x > cx + 20 ? "right" : labelPos.x < cx - 20 ? "left" : "middle",
    });
    angle = end;
  }
  avoidLabelCollisions(labelItems);
  const labels = labelItems.map((item) => [
    `<text x="${item.x.toFixed(2)}" y="${(item.y - 18).toFixed(2)}" text-anchor="${item.anchor}" fill="${item.color}" class="label">`,
    `<tspan x="${item.x.toFixed(2)}">${escapeXml(item.label)}</tspan>`,
    `<tspan x="${item.x.toFixed(2)}" dy="48">${item.percentage}%</tspan>`,
    "</text>",
  ].join(""));

  return `
<svg id="chart" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="8" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
    <style>
      .label {
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
        font-weight: 800;
        font-size: 34px;
        letter-spacing: 0;
      }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g filter="url(#shadow)">
    ${paths.join("\n    ")}
  </g>
  ${labels.join("\n  ")}
</svg>`;
}

export async function renderAssetPieChartPng(
  model: StockPortfolioPieChartModel,
  params: { profile: string; generatedAt: Date; outputDir?: string },
): Promise<string> {
  const outputDir = params.outputDir ?? join(homedir(), ".miniclaw/runtime/charts");
  mkdirSync(outputDir, { recursive: true });
  const stamp = params.generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const path = join(outputDir, `stock-portfolio-${params.profile}-${stamp}.png`);
  const svg = renderAssetPieChartSvg(model);
  const html = `<!doctype html><html><head><meta charset="utf-8"/></head><body style="margin:0;background:#fff">${svg}</body></html>`;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1300 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.locator("#chart").screenshot({ path });
    return path;
  } finally {
    await browser.close();
  }
}

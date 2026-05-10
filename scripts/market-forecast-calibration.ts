import { initDb } from "../src/store/db.js";
import { listMarketForecastCalibrationRecords } from "../src/store/market-forecasts.js";
import {
  buildMarketIntelScoringCalibrationConfig,
  summarizeMarketForecastCalibration,
  type MarketForecastCalibrationGroup,
} from "../src/providers/market-forecast-evaluation/calibration.js";
import {
  getMarketIntelScoringCalibrationConfigPath,
  writeMarketIntelScoringCalibrationConfig,
} from "../src/providers/market-intel/calibration.js";

function argValue(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1) ?? fallback;
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function fmt(value: string | number | undefined): string {
  if (value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return value;
}

function groupLine(group: MarketForecastCalibrationGroup): string {
  return [
    group.key,
    `forecasts=${group.forecasts}`,
    `evaluated=${group.evaluated_forecasts}`,
    `scores=${group.score_count}`,
    `hit=${group.hit_count}`,
    `miss=${group.miss_count}`,
    `unknown=${group.unknown_count}`,
    `hit_rate=${fmt(group.hit_rate)}`,
    `avg_brier=${fmt(group.avg_brier_score)}`,
  ].join(" | ");
}

const days = Math.max(1, Math.min(90, Number.parseInt(argValue("--days", "7") ?? "7", 10) || 7));
const limit = Math.max(1, Math.min(500, Number.parseInt(argValue("--limit", "100") ?? "100", 10) || 100));
const marketScope = argValue("--market-scope");
const since = argValue("--since", daysAgoIso(days));
const until = argValue("--until");
const format = argValue("--format", "text");
const writeConfig = process.argv.includes("--write-config");
const minSamples = Math.max(1, Math.min(100, Number.parseInt(argValue("--min-samples", "5") ?? "5", 10) || 5));
const configPath = argValue("--config-path", getMarketIntelScoringCalibrationConfigPath());

initDb();

const records = listMarketForecastCalibrationRecords({
  marketScope,
  since,
  until,
  limit,
});
const summary = summarizeMarketForecastCalibration({
  records,
  since,
  until,
  marketScope,
  requestedDays: days,
});

if (format === "json") {
  const calibration_config = buildMarketIntelScoringCalibrationConfig(summary, { minSamples });
  console.log(JSON.stringify({ ...summary, calibration_config }, null, 2));
  process.exit(0);
}

console.log(`Market forecast calibration | generated_at=${summary.generated_at}`);
console.log([
  `window_since=${fmt(summary.window.since)}`,
  `window_until=${fmt(summary.window.until)}`,
  `market_scope=${fmt(summary.window.market_scope)}`,
  `records=${records.length}`,
].join(" | "));

console.log("\nTotals");
console.log(groupLine(summary.totals));

if (summary.by_market_scope.length) {
  console.log("\nBy market scope");
  for (const group of summary.by_market_scope) console.log(groupLine(group));
}

if (summary.by_data_quality.length) {
  console.log("\nBy data quality");
  for (const group of summary.by_data_quality) console.log(groupLine(group));
}

if (summary.by_forecast_source.length) {
  console.log("\nBy forecast source");
  for (const group of summary.by_forecast_source) console.log(groupLine(group));
}

if (summary.by_score_type.length) {
  console.log("\nBy score type");
  for (const group of summary.by_score_type) console.log(groupLine(group));
}

console.log("\nProposed source reliability weights");
if (!summary.source_reliability_weights.length) {
  console.log("- no source samples");
} else {
  for (const weight of summary.source_reliability_weights) {
    console.log([
      `- ${weight.source}`,
      `samples=${weight.samples}`,
      `hit_rate=${fmt(weight.hit_rate)}`,
      `avg_brier=${fmt(weight.avg_brier_score)}`,
      `proposed_weight=${fmt(weight.proposed_weight)}`,
      `confidence_cap=${fmt(weight.confidence_cap)}`,
      weight.rationale,
    ].join(" | "));
  }
}

console.log("\nWeak spots");
for (const [key, value] of Object.entries(summary.weak_spots)) {
  console.log(`- ${key}=${value}`);
}

console.log("\nRecommendations");
for (const recommendation of summary.recommendations) {
  console.log(`- ${recommendation}`);
}

const calibrationConfig = buildMarketIntelScoringCalibrationConfig(summary, { minSamples });
console.log("\nRuntime calibration config");
console.log(`- min_samples=${minSamples}`);
console.log(`- eligible_source_weights=${calibrationConfig.source_weights.length}`);
console.log(`- prompt_rules=${calibrationConfig.prompt_rules.length}`);
if (writeConfig) {
  if (!calibrationConfig.source_weights.length && !calibrationConfig.prompt_rules.length) {
    console.log("- write skipped: no eligible source weights or prompt rules were produced.");
  } else {
    writeMarketIntelScoringCalibrationConfig(calibrationConfig, configPath);
    console.log(`- wrote ${configPath}`);
  }
}

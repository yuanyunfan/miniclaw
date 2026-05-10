import { initDb } from "../src/store/db.js";
import { listMarketForecastItems, listRecentMarketForecasts } from "../src/store/market-forecasts.js";

function argValue(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1) ?? fallback;
}

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

initDb();

const limit = Math.max(1, Math.min(50, Number.parseInt(argValue("--limit", "10"), 10) || 10));
const forecasts = listRecentMarketForecasts(limit);

if (!forecasts.length) {
  console.log("No market forecasts found.");
  process.exit(0);
}

for (const forecast of forecasts) {
  console.log([
    `${forecast.generated_at} ${forecast.market_scope}/${forecast.session}`,
    `trade_date=${forecast.trade_date}`,
    `calendar=${forecast.calendar_status}`,
    `quality=${fmt(forecast.data_quality_status)}`,
    `job=${fmt(forecast.job_name)}`,
    `task=${fmt(forecast.task_id)}`,
    `id=${forecast.id}`,
  ].join(" | "));

  const items = listMarketForecastItems(forecast.id).slice(0, 12);
  for (const item of items) {
    console.log([
      `  - ${item.source}:${item.item_type}`,
      item.target,
      item.direction,
      `p=${fmt(item.probability)}`,
      `conf=${fmt(item.confidence)}`,
    ].join(" | "));
  }
}

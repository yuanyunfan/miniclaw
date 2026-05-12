import type { SchemaMigration } from "./types.js";

export const migration007MarketForecasts: SchemaMigration = {
  version: 7,
  name: "007_market_forecasts",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS market_forecasts (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        job_name TEXT,
        channel_id TEXT,
        market_scope TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        session TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        calendar_status TEXT NOT NULL,
        data_quality_status TEXT,
        payload_json TEXT NOT NULL,
        report_text TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_market_forecasts_task ON market_forecasts(task_id);
      CREATE INDEX IF NOT EXISTS idx_market_forecasts_scope_date ON market_forecasts(market_scope, trade_date, session);
      CREATE TABLE IF NOT EXISTS market_forecast_items (
        id TEXT PRIMARY KEY,
        forecast_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        target TEXT NOT NULL,
        direction TEXT NOT NULL,
        probability REAL,
        confidence REAL,
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        invalidation TEXT,
        rationale TEXT,
        source TEXT NOT NULL DEFAULT 'provider_score',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
      );
      CREATE INDEX IF NOT EXISTS idx_market_forecast_items_forecast ON market_forecast_items(forecast_id, item_type);
      CREATE TABLE IF NOT EXISTS market_forecast_evaluations (
        id TEXT PRIMARY KEY,
        forecast_id TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        outcome_json TEXT NOT NULL,
        score_json TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (forecast_id) REFERENCES market_forecasts(id)
      );
      CREATE INDEX IF NOT EXISTS idx_market_forecast_evaluations_forecast ON market_forecast_evaluations(forecast_id, evaluated_at);
    `);
  },
};

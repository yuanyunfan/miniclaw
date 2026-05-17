import type { SchemaMigration } from "./types.js";

export const migration015MarketContext: SchemaMigration = {
  version: 15,
  name: "015_market_context",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS market_context_daily (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        job_name TEXT,
        channel_id TEXT,
        market_scope TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        previous_context_id TEXT,
        digest_text TEXT NOT NULL,
        active_items_json TEXT NOT NULL DEFAULT '[]',
        new_items_json TEXT NOT NULL DEFAULT '[]',
        resolved_items_json TEXT NOT NULL DEFAULT '[]',
        data_quality_json TEXT NOT NULL DEFAULT '{}',
        source_payload_json TEXT,
        report_text TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (previous_context_id) REFERENCES market_context_daily(id),
        UNIQUE(market_scope, trade_date)
      );
      CREATE INDEX IF NOT EXISTS idx_market_context_daily_scope_date
        ON market_context_daily(market_scope, trade_date);
      CREATE INDEX IF NOT EXISTS idx_market_context_daily_task
        ON market_context_daily(task_id);

      CREATE TABLE IF NOT EXISTS market_context_items (
        id TEXT PRIMARY KEY,
        market_scope TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        topic TEXT NOT NULL,
        fact TEXT NOT NULL,
        market_impact TEXT NOT NULL,
        affected_markets_json TEXT NOT NULL DEFAULT '[]',
        horizon TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL,
        source_urls_json TEXT NOT NULL DEFAULT '[]',
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        first_seen_at TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        expires_at TEXT,
        source_daily_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (source_daily_id) REFERENCES market_context_daily(id),
        UNIQUE(market_scope, stable_key)
      );
      CREATE INDEX IF NOT EXISTS idx_market_context_items_scope_status
        ON market_context_items(market_scope, status, last_updated_at);
      CREATE INDEX IF NOT EXISTS idx_market_context_items_daily
        ON market_context_items(source_daily_id);
    `);
  },
};

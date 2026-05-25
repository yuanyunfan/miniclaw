import type { SchemaMigration } from "./types.js";

export const migration018CliSessionApprovals: SchemaMigration = {
  version: 18,
  name: "018_cli_session_approvals",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cli_session_approvals (
        id TEXT PRIMARY KEY,
        cli_session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        tool_name TEXT,
        tool_use_id TEXT,
        request_json TEXT NOT NULL,
        status TEXT NOT NULL,
        decision_json TEXT,
        actor_id TEXT,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (cli_session_id) REFERENCES cli_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_cli_session_approvals_session_status
        ON cli_session_approvals(cli_session_id, status, requested_at);
      CREATE INDEX IF NOT EXISTS idx_cli_session_approvals_status_expires
        ON cli_session_approvals(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_cli_session_approvals_provider_session
        ON cli_session_approvals(provider, provider_session_id, requested_at);
    `);
  },
};

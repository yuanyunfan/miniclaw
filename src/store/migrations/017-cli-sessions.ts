import type { SchemaMigration } from "./types.js";

export const migration017CliSessions: SchemaMigration = {
  version: 17,
  name: "017_cli_sessions",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cli_sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        pid INTEGER,
        tty TEXT,
        terminal_app TEXT,
        terminal_surface_json TEXT,
        transcript_path TEXT,
        phase TEXT NOT NULL,
        attention_kind TEXT,
        latest_summary TEXT,
        latest_prompt TEXT,
        last_event_name TEXT,
        last_activity_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        hidden_at TEXT,
        observed_prompt_count INTEGER NOT NULL DEFAULT 0,
        transcript_activity_at TEXT,
        UNIQUE(provider, provider_session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_provider_session
        ON cli_sessions(provider, provider_session_id);
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_phase_activity
        ON cli_sessions(phase, last_activity_at);
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_cwd_activity
        ON cli_sessions(cwd, last_activity_at);
      CREATE INDEX IF NOT EXISTS idx_cli_sessions_hidden_activity
        ON cli_sessions(hidden_at, last_activity_at);

      CREATE TABLE IF NOT EXISTS cli_session_events (
        id TEXT PRIMARY KEY,
        cli_session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        event_name TEXT NOT NULL,
        phase TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (cli_session_id) REFERENCES cli_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_cli_session_events_session_created
        ON cli_session_events(cli_session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_cli_session_events_provider_created
        ON cli_session_events(provider, created_at);
    `);
  },
};

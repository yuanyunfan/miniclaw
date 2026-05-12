import type { SchemaMigration } from "./types.js";

export const migration004DoctorIncidents: SchemaMigration = {
  version: 4,
  name: "004_doctor_incidents",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        subject_id TEXT,
        subject_type TEXT,
        source_json TEXT,
        evidence_json TEXT,
        diagnosis_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE INDEX IF NOT EXISTS idx_incidents_updated_at ON incidents(updated_at);
      CREATE TABLE IF NOT EXISTS incident_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (incident_id) REFERENCES incidents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id, created_at);
      CREATE TABLE IF NOT EXISTS repair_runs (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        status TEXT NOT NULL,
        workspace_path TEXT,
        branch TEXT,
        base_sha TEXT,
        commit_sha TEXT,
        verification_json TEXT,
        report_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (incident_id) REFERENCES incidents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_repair_runs_incident ON repair_runs(incident_id, created_at);
    `);
  },
};

import type Database from "better-sqlite3";

export function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.some((r) => r.name === column);
}

export function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function ensureSchemaVersionHistoryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_version INTEGER,
      to_version INTEGER NOT NULL,
      migration_name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_version_history_to_version
      ON schema_version_history(to_version);
  `);
}

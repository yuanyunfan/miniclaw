import { getDb } from "./db.js";

export interface MemoryRow {
  id: number;
  type: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function addMemory(type: string, name: string, content: string): MemoryRow {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM memories WHERE type = ? AND name = ?")
    .get(type, name) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE memories SET content = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(content, existing.id);
    return db.prepare("SELECT * FROM memories WHERE id = ?").get(existing.id) as MemoryRow;
  }

  const info = db
    .prepare("INSERT INTO memories (type, name, content) VALUES (?, ?, ?)")
    .run(type, name, content);
  return db.prepare("SELECT * FROM memories WHERE id = ?").get(info.lastInsertRowid) as MemoryRow;
}

export function deleteMemory(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getAllMemories(): MemoryRow[] {
  return getDb()
    .prepare("SELECT * FROM memories ORDER BY updated_at DESC")
    .all() as MemoryRow[];
}

export function getMemoriesByType(type: string): MemoryRow[] {
  return getDb()
    .prepare("SELECT * FROM memories WHERE type = ? ORDER BY updated_at DESC")
    .all(type) as MemoryRow[];
}

export function searchMemories(query: string): MemoryRow[] {
  const pattern = `%${query}%`;
  return getDb()
    .prepare(
      "SELECT * FROM memories WHERE name LIKE ? OR content LIKE ? ORDER BY updated_at DESC"
    )
    .all(pattern, pattern) as MemoryRow[];
}

#!/usr/bin/env tsx
// 一次性迁移：把 SQLite memories 表导出到 ~/.miniclaw/memories/MEMORY.md
// 用法: pnpm tsx scripts/migrate-memories.ts
//   --dry-run  只打印不写入
//   --backup   写入前备份现 MEMORY.md 到 .bak.<ts>

import { initDb, getDb } from "../src/store/db.js";
import { addMemory, getAllMemories } from "../src/store/memory-md.js";
import { existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface SqliteRow { type: string; name: string; content: string; }

const DRY = process.argv.includes("--dry-run");
const DO_BACKUP = process.argv.includes("--backup");

const mdPath = process.env.MINICLAW_MEMORY_PATH ?? join(homedir(), ".miniclaw/memories/MEMORY.md");

initDb();
const sqliteRows = getDb()
  .prepare("SELECT type, name, content FROM memories ORDER BY id")
  .all() as SqliteRow[];

console.log(`📦 SQLite memories: ${sqliteRows.length} 条`);
for (const r of sqliteRows) {
  console.log(`  [${r.type}] ${r.name} — ${r.content.slice(0, 50)}${r.content.length > 50 ? "..." : ""}`);
}

if (DRY) {
  console.log("\n🌵 --dry-run 已设置，不写入。");
  process.exit(0);
}

if (DO_BACKUP && existsSync(mdPath)) {
  const bak = `${mdPath}.bak.${Date.now()}`;
  copyFileSync(mdPath, bak);
  console.log(`💾 已备份现 MEMORY.md → ${bak}`);
}

let migrated = 0;
for (const r of sqliteRows) {
  addMemory(r.type, r.name, r.content);
  migrated++;
}

const finalRows = getAllMemories();
console.log(`\n✅ 迁移完成: ${migrated} 条 → ${mdPath}`);
console.log(`   写入后实际 MEMORY.md 条数: ${finalRows.length}`);
if (finalRows.length !== sqliteRows.length) {
  console.warn(`⚠️  数量不一致（可能是 (type, name) 去重）`);
}

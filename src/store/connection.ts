import type Database from "better-sqlite3";

let db: Database.Database | undefined;

export function setDb(database: Database.Database): void {
  db = database;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database has not been initialized. Call initDb() before using store repositories.");
  }
  return db;
}

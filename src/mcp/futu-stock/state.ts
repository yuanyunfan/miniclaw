import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { FutuAccountSnapshot } from "./types.js";

function resolveHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function snapshotPath(snapshotDir: string, capturedAt: string): string {
  const date = capturedAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  return join(resolveHome(snapshotDir), `${date}.json`);
}

export function saveFutuSnapshot(snapshotDir: string, snapshot: FutuAccountSnapshot): string {
  const path = snapshotPath(snapshotDir, snapshot.captured_at);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  renameSync(tmp, path);
  return path;
}

export function loadFutuSnapshot(path: string): FutuAccountSnapshot | undefined {
  const resolved = resolveHome(path);
  if (!existsSync(resolved)) return undefined;
  const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") return undefined;
  return raw as FutuAccountSnapshot;
}

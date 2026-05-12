import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ConfigReader } from "./env.js";
import type { ConfigPath } from "./types.js";
import { isPlainObject } from "./schema.js";

export function resolveHome(p: string): string {
  const trimmed = p.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export function channelDefaults(
  reader: ConfigReader,
  paths: ConfigPath,
  envKeys: string | readonly string[]
): Record<string, { cwd: string }> {
  const raw = reader.readRaw(paths, envKeys, {});
  const name = reader.optionName(paths, envKeys);
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid config ${name}: expected object keyed by Discord channel id`);
  }

  const out: Record<string, { cwd: string }> = {};
  for (const [channelId, value] of Object.entries(raw)) {
    if (!channelId.trim()) continue;
    if (!isPlainObject(value)) {
      throw new Error(`Invalid config ${name}.${channelId}: expected object`);
    }
    const cwdRaw = reader.scalarString(value.cwd, `${name}.${channelId}.cwd`);
    if (cwdRaw) out[channelId] = { cwd: resolveHome(cwdRaw) };
  }
  return out;
}

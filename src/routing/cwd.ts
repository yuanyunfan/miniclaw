import { homedir } from "node:os";
import { resolve } from "node:path";
import { config } from "../config.js";

export function resolveHomePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export function resolveTaskCwd(channelId: string | undefined, explicitCwd?: string | null): string {
  if (explicitCwd?.trim()) return resolveHomePath(explicitCwd);
  if (channelId) {
    const channelDefault = config.channelDefaults[channelId];
    if (channelDefault?.cwd) return channelDefault.cwd;
  }
  return config.defaultCwd;
}

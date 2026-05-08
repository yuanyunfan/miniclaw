import { homedir } from "node:os";
import { resolve } from "node:path";
import { assertE2eSafeRuntimePath, config } from "../config.js";

export function resolveHomePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export function resolveTaskCwd(channelId: string | undefined, explicitCwd?: string | null): string {
  if (explicitCwd?.trim()) {
    const cwd = resolveHomePath(explicitCwd);
    assertE2eSafeRuntimePath("explicit task cwd", cwd);
    return cwd;
  }
  if (channelId) {
    const channelDefault = config.channelDefaults[channelId];
    if (channelDefault?.cwd) return channelDefault.cwd;
  }
  return config.defaultCwd;
}

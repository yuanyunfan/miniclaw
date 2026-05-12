import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export interface E2eIsolationConfig {
  e2eMode: boolean;
  configuredConfigPath?: string;
  configPath: string;
  senderUserIds: readonly string[];
  disableScheduler: boolean;
  fakeAgent: boolean;
  dbPath: string;
  memoryPath: string;
  defaultCwd: string;
  channelDefaults: Record<string, { cwd: string }>;
  tempRoot?: string;
}

export function isUnderDir(path: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertE2ePathUnderTemp(kind: string, path: string, tempRoot = tmpdir()): void {
  if (!isUnderDir(path, tempRoot)) {
    throw new Error(`E2E mode requires ${kind} to be under system temp dir ${tempRoot}: ${path}`);
  }
}

export function assertE2eRuntimePath(kind: string, path: string, e2eMode: boolean, tempRoot = tmpdir()): void {
  if (!e2eMode) return;
  if (!isUnderDir(path, tempRoot)) {
    throw new Error(`E2E mode refuses ${kind} outside system temp dir ${tempRoot}: ${path}`);
  }
}

export function assertE2eIsolation(config: E2eIsolationConfig): void {
  if (!config.e2eMode) {
    if (config.fakeAgent) {
      throw new Error("MINICLAW_E2E_FAKE_AGENT requires MINICLAW_E2E_MODE=true");
    }
    return;
  }

  if (!config.configuredConfigPath) {
    throw new Error("E2E mode requires MINICLAW_CONFIG to point to a temp config file");
  }
  if (!config.senderUserIds.length) {
    throw new Error("E2E mode requires MINICLAW_E2E_SENDER_USER_IDS");
  }
  if (!config.disableScheduler) {
    throw new Error("E2E mode requires MINICLAW_DISABLE_SCHEDULER=true");
  }

  const tempRoot = config.tempRoot ?? tmpdir();
  assertE2ePathUnderTemp("MINICLAW_CONFIG", config.configPath, tempRoot);
  assertE2ePathUnderTemp("MINICLAW_DB_PATH", config.dbPath, tempRoot);
  assertE2ePathUnderTemp("MINICLAW_MEMORY_PATH", config.memoryPath, tempRoot);
  assertE2ePathUnderTemp("MINICLAW_DEFAULT_CWD", config.defaultCwd, tempRoot);
  for (const [channelId, value] of Object.entries(config.channelDefaults)) {
    assertE2ePathUnderTemp(`routing.channel_defaults.${channelId}.cwd`, value.cwd, tempRoot);
  }
}

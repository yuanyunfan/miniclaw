import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type HookInstallProvider = "claude" | "codex";
export type HookInstallAction = "install" | "uninstall" | "doctor";

export interface HookInstallPaths {
  claudeSettingsPath: string;
  codexHooksPath: string;
  codexConfigPath: string;
  manifestPath: string;
  hookClientPath: string;
  socketPath: string;
}

export interface HookInstallOptions {
  providers: HookInstallProvider[];
  action: HookInstallAction;
  execute: boolean;
  enableCodexFeature?: boolean;
  approvalTimeoutMs: number;
  hookTimeoutMs: number;
  paths?: Partial<HookInstallPaths>;
  cwd?: string;
}

export interface HookInstallResult {
  provider: HookInstallProvider;
  status: "ok" | "changed" | "skipped" | "warn";
  detail: string;
}

export interface HookConfigEntry {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
}

type JsonObject = Record<string, unknown>;

const MANAGED_MARKER = "MINICLAW_HOOKD_MANAGED=1";
const CLAUDE_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
] as const;
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;

function homePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed as JsonObject;
}

function writeJsonObject(path: string, value: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function defaultHookInstallPaths(cwd = process.cwd()): HookInstallPaths {
  return {
    claudeSettingsPath: homePath("~/.claude/settings.json"),
    codexHooksPath: homePath("~/.codex/hooks.json"),
    codexConfigPath: homePath("~/.codex/config.toml"),
    manifestPath: homePath("~/.miniclaw/hooks/manifest.json"),
    hookClientPath: resolve(cwd, "dist/hookd/hook-client.js"),
    socketPath: homePath("~/.miniclaw/runtime/hookd.sock"),
  };
}

export function managedHookCommand(provider: HookInstallProvider, paths: HookInstallPaths, timeoutMs: number): string {
  return [
    MANAGED_MARKER,
    `MINICLAW_HOOKD_PROVIDER=${provider}`,
    `MINICLAW_HOOKD_SOCKET=${shellQuote(paths.socketPath)}`,
    `MINICLAW_HOOKD_TIMEOUT_MS=${timeoutMs}`,
    "node",
    shellQuote(paths.hookClientPath),
    "--provider",
    provider,
    "--socket",
    shellQuote(paths.socketPath),
    "--timeout-ms",
    String(timeoutMs),
  ].join(" ");
}

function hookEntries(provider: HookInstallProvider, paths: HookInstallPaths, options: HookInstallOptions): HookConfigEntry[] {
  const timeoutMs = provider === "claude" ? options.approvalTimeoutMs + 5_000 : options.hookTimeoutMs;
  const command = managedHookCommand(provider, paths, timeoutMs);
  if (provider === "claude") {
    return CLAUDE_EVENTS.map((event) => ({
      event,
      matcher: event === "SessionStart" ? "startup|clear|compact" : event === "PreCompact" ? "auto|manual" : "*",
      command,
      timeout: event === "PermissionRequest" ? Math.ceil(timeoutMs / 1000) : Math.ceil(options.hookTimeoutMs / 1000),
    }));
  }
  return CODEX_EVENTS.map((event) => ({
    event,
    ...(event === "SessionStart" ? { matcher: "startup|resume" } : {}),
    command,
    timeout: Math.ceil(options.hookTimeoutMs / 1000),
  }));
}

function isManagedHook(hook: unknown): boolean {
  return !!hook
    && typeof hook === "object"
    && typeof (hook as { command?: unknown }).command === "string"
    && (hook as { command: string }).command.includes(MANAGED_MARKER);
}

export function removeManagedHookEntries(config: JsonObject): { config: JsonObject; removed: number } {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return { config, removed: 0 };
  let removed = 0;
  const hookMap = hooks as Record<string, unknown>;
  for (const [event, groupsRaw] of Object.entries(hookMap)) {
    if (!Array.isArray(groupsRaw)) continue;
    const groups = groupsRaw
      .map((groupRaw) => {
        if (!groupRaw || typeof groupRaw !== "object" || Array.isArray(groupRaw)) return groupRaw;
        const group = groupRaw as Record<string, unknown>;
        if (!Array.isArray(group.hooks)) return groupRaw;
        const keptHooks = group.hooks.filter((hook) => {
          const managed = isManagedHook(hook);
          if (managed) removed++;
          return !managed;
        });
        return { ...group, hooks: keptHooks };
      })
      .filter((groupRaw) => {
        if (!groupRaw || typeof groupRaw !== "object" || Array.isArray(groupRaw)) return true;
        const group = groupRaw as Record<string, unknown>;
        return !Array.isArray(group.hooks) || group.hooks.length > 0;
      });
    if (groups.length) hookMap[event] = groups;
    else delete hookMap[event];
  }
  return { config, removed };
}

export function addManagedHookEntries(config: JsonObject, entries: HookConfigEntry[]): { config: JsonObject; added: number } {
  const hooks = config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks)
    ? config.hooks as Record<string, unknown>
    : {};
  config.hooks = hooks;
  let added = 0;
  for (const entry of entries) {
    const groups = Array.isArray(hooks[entry.event]) ? hooks[entry.event] as JsonObject[] : [];
    hooks[entry.event] = groups;
    const group = groups.find((candidate) =>
      typeof candidate === "object"
      && !Array.isArray(candidate)
      && (candidate.matcher ?? "*") === (entry.matcher ?? "*")
      && Array.isArray(candidate.hooks)
    );
    const target = group ?? {
      ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
      hooks: [],
    };
    if (!group) groups.push(target);
    const targetHooks = target.hooks as unknown[];
    targetHooks.push({
      type: "command",
      command: entry.command,
      ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
    });
    added++;
  }
  return { config, added };
}

export function codexHooksFeatureEnabled(toml: string): boolean {
  const lines = toml.split(/\r?\n/);
  let inFeatures = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      inFeatures = /^\s*\[features]\s*$/.test(line);
      continue;
    }
    if (inFeatures && /^\s*codex_hooks\s*=\s*true\s*(?:#.*)?$/.test(line)) return true;
  }
  return false;
}

export function enableCodexHooksFeature(toml: string): string {
  if (codexHooksFeatureEnabled(toml)) return toml;
  const featureMatch = toml.match(/^\s*\[features]\s*$/m);
  if (!featureMatch || featureMatch.index === undefined) {
    return `${toml.trimEnd()}\n\n[features]\ncodex_hooks = true\n`;
  }
  const start = featureMatch.index + featureMatch[0].length;
  const nextSection = toml.slice(start).search(/^\s*\[/m);
  const end = nextSection === -1 ? toml.length : start + nextSection;
  const section = toml.slice(start, end);
  if (/^\s*codex_hooks\s*=/m.test(section)) {
    return `${toml.slice(0, start)}${section.replace(/^\s*codex_hooks\s*=.*$/m, "codex_hooks = true")}${toml.slice(end)}`;
  }
  return `${toml.slice(0, end).trimEnd()}\ncodex_hooks = true\n${toml.slice(end)}`;
}

function effectivePaths(options: HookInstallOptions): HookInstallPaths {
  return {
    ...defaultHookInstallPaths(options.cwd),
    ...Object.fromEntries(Object.entries(options.paths ?? {}).map(([key, value]) => [
      key,
      typeof value === "string" && value ? homePath(value) : value,
    ])),
  } as HookInstallPaths;
}

function installProvider(provider: HookInstallProvider, paths: HookInstallPaths, options: HookInstallOptions): HookInstallResult {
  if (provider === "codex") {
    const toml = existsSync(paths.codexConfigPath) ? readFileSync(paths.codexConfigPath, "utf8") : "";
    if (!codexHooksFeatureEnabled(toml) && !options.enableCodexFeature) {
      return { provider, status: "skipped", detail: "codex_hooks feature is not enabled" };
    }
    if (options.execute && options.enableCodexFeature && !codexHooksFeatureEnabled(toml)) {
      mkdirSync(dirname(paths.codexConfigPath), { recursive: true });
      writeFileSync(paths.codexConfigPath, enableCodexHooksFeature(toml));
    }
  }

  const path = provider === "claude" ? paths.claudeSettingsPath : paths.codexHooksPath;
  const original = readJsonObject(path);
  const removed = removeManagedHookEntries(original);
  const entries = hookEntries(provider, paths, options);
  const next = addManagedHookEntries(removed.config, entries);
  if (options.execute) writeJsonObject(path, next.config);
  return {
    provider,
    status: removed.removed || next.added ? "changed" : "ok",
    detail: `${options.execute ? "installed" : "would install"} ${next.added} managed hook entry(s), removed ${removed.removed} stale managed hook entry(s)`,
  };
}

function uninstallProvider(provider: HookInstallProvider, paths: HookInstallPaths, options: HookInstallOptions): HookInstallResult {
  const path = provider === "claude" ? paths.claudeSettingsPath : paths.codexHooksPath;
  const original = readJsonObject(path);
  const removed = removeManagedHookEntries(original);
  if (options.execute) writeJsonObject(path, removed.config);
  return {
    provider,
    status: removed.removed ? "changed" : "ok",
    detail: `${options.execute ? "removed" : "would remove"} ${removed.removed} managed hook entry(s)`,
  };
}

function doctorProvider(provider: HookInstallProvider, paths: HookInstallPaths): HookInstallResult {
  const path = provider === "claude" ? paths.claudeSettingsPath : paths.codexHooksPath;
  const config = readJsonObject(path);
  const hooks = config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks)
    ? config.hooks as Record<string, unknown>
    : {};
  const managedCount = Object.values(hooks).flatMap((groups) =>
    Array.isArray(groups)
      ? groups.flatMap((group) => group && typeof group === "object" && !Array.isArray(group) && Array.isArray((group as { hooks?: unknown }).hooks)
        ? (group as { hooks: unknown[] }).hooks
        : [])
      : []
  ).filter(isManagedHook).length;
  const socketStatus = existsSync(paths.socketPath) && statSync(paths.socketPath).isSocket() ? "socket reachable path exists" : "socket path is not active";
  const feature = provider === "codex" && existsSync(paths.codexConfigPath)
    ? `, codex_hooks=${codexHooksFeatureEnabled(readFileSync(paths.codexConfigPath, "utf8")) ? "true" : "false"}`
    : "";
  return {
    provider,
    status: managedCount ? "ok" : "warn",
    detail: `${managedCount} managed hook entry(s), ${socketStatus}${feature}`,
  };
}

export function runHookdHookInstall(options: HookInstallOptions): HookInstallResult[] {
  const paths = effectivePaths(options);
  const results: HookInstallResult[] = [];
  for (const provider of options.providers) {
    if (options.action === "install") results.push(installProvider(provider, paths, options));
    else if (options.action === "uninstall") results.push(uninstallProvider(provider, paths, options));
    else results.push(doctorProvider(provider, paths));
  }
  if (options.action === "install" && options.execute) {
    mkdirSync(dirname(paths.manifestPath), { recursive: true });
    writeJsonObject(paths.manifestPath, {
      version: 1,
      managed_by: "miniclaw-hookd",
      installed_at: new Date().toISOString(),
      hook_client_path: paths.hookClientPath,
      socket_path: paths.socketPath,
      providers: options.providers,
    });
  }
  if (options.action === "uninstall" && options.execute && existsSync(paths.manifestPath)) {
    rmSync(paths.manifestPath, { force: true });
  }
  return results;
}

export const __testables = {
  MANAGED_MARKER,
  hookEntries,
  readJsonObject,
};

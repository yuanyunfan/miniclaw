import { config } from "../src/config.js";
import {
  runHookdHookInstall,
  type HookInstallAction,
  type HookInstallProvider,
} from "../src/hookd/installer.js";

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function providers(): HookInstallProvider[] {
  const raw = argValue("--provider") ?? "all";
  if (raw === "all") return ["claude", "codex"];
  const parsed = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (!parsed.every((value): value is HookInstallProvider => value === "claude" || value === "codex")) {
    throw new Error("--provider must be claude, codex, or all");
  }
  return parsed;
}

function action(): HookInstallAction {
  if (hasArg("--uninstall")) return "uninstall";
  if (hasArg("--doctor")) return "doctor";
  return "install";
}

const execute = hasArg("--execute");
const results = runHookdHookInstall({
  providers: providers(),
  action: action(),
  execute,
  enableCodexFeature: hasArg("--enable-codex-feature"),
  approvalTimeoutMs: config.hookd.approvalTimeoutMs,
  hookTimeoutMs: Number(argValue("--hook-timeout-ms") ?? 10_000),
  paths: {
    socketPath: config.hookd.socketPath,
    ...(argValue("--hook-client") ? { hookClientPath: argValue("--hook-client")! } : {}),
    ...(argValue("--claude-settings") ? { claudeSettingsPath: argValue("--claude-settings")! } : {}),
    ...(argValue("--codex-hooks") ? { codexHooksPath: argValue("--codex-hooks")! } : {}),
    ...(argValue("--codex-config") ? { codexConfigPath: argValue("--codex-config")! } : {}),
  },
});

for (const result of results) {
  process.stdout.write(`${result.provider}: ${result.status} - ${result.detail}\n`);
}
if (!execute && action() !== "doctor") {
  process.stdout.write("Dry-run only. Re-run with --execute to modify provider hook files.\n");
}

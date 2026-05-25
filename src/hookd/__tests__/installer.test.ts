import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addManagedHookEntries,
  codexHooksFeatureEnabled,
  enableCodexHooksFeature,
  managedHookCommand,
  removeManagedHookEntries,
  runHookdHookInstall,
  type HookInstallPaths,
} from "../installer.js";

const paths: HookInstallPaths = {
  claudeSettingsPath: "/home/user/.claude/settings.json",
  codexHooksPath: "/home/user/.codex/hooks.json",
  codexConfigPath: "/home/user/.codex/config.toml",
  manifestPath: "/home/user/.miniclaw/hooks/manifest.json",
  hookClientPath: "/repo/dist/hookd/hook-client.js",
  socketPath: "/home/user/.miniclaw/runtime/hookd.sock",
};

describe("hookd installer pure mutations", () => {
  it("adds and removes only MiniClaw-managed hook entries", () => {
    const command = managedHookCommand("claude", paths, 600_000);
    const config = {
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "echo user-hook" },
            ],
          },
        ],
      },
    };

    const added = addManagedHookEntries(config, [{
      event: "Stop",
      matcher: "*",
      command,
      timeout: 10,
    }]);

    expect(added.added).toBe(1);
    expect(JSON.stringify(added.config)).toContain("echo user-hook");
    expect(JSON.stringify(added.config)).toContain("MINICLAW_HOOKD_MANAGED=1");

    const removed = removeManagedHookEntries(added.config);
    expect(removed.removed).toBe(1);
    expect(JSON.stringify(removed.config)).toContain("echo user-hook");
    expect(JSON.stringify(removed.config)).not.toContain("MINICLAW_HOOKD_MANAGED=1");
  });

  it("detects and enables the Codex hooks feature in the features section", () => {
    const config = "model = \"gpt-5\"\n\n[features]\nrmcp_client = true\n";

    expect(codexHooksFeatureEnabled(config)).toBe(false);
    const enabled = enableCodexHooksFeature(config);
    expect(codexHooksFeatureEnabled(enabled)).toBe(true);
    expect(enabled).toContain("codex_hooks = true");
  });

  it("keeps manifest providers when Claude and Codex are installed separately", () => {
    const tmp = mkdtempSync(join(tmpdir(), "miniclaw-hookd-install-"));
    const tempPaths: HookInstallPaths = {
      claudeSettingsPath: join(tmp, ".claude", "settings.json"),
      codexHooksPath: join(tmp, ".codex", "hooks.json"),
      codexConfigPath: join(tmp, ".codex", "config.toml"),
      manifestPath: join(tmp, ".miniclaw", "hooks", "manifest.json"),
      hookClientPath: "/repo/dist/hookd/hook-client.js",
      socketPath: join(tmp, ".miniclaw", "runtime", "hookd.sock"),
    };
    mkdirSync(join(tmp, ".codex"), { recursive: true });
    writeFileSync(tempPaths.codexConfigPath, "[features]\ncodex_hooks = true\n");

    runHookdHookInstall({
      providers: ["codex"],
      action: "install",
      execute: true,
      approvalTimeoutMs: 600_000,
      hookTimeoutMs: 10_000,
      paths: tempPaths,
    });
    runHookdHookInstall({
      providers: ["claude"],
      action: "install",
      execute: true,
      approvalTimeoutMs: 600_000,
      hookTimeoutMs: 10_000,
      paths: tempPaths,
    });

    const manifest = JSON.parse(readFileSync(tempPaths.manifestPath, "utf8")) as { providers: string[] };
    expect(manifest.providers).toEqual(["claude", "codex"]);

    runHookdHookInstall({
      providers: ["claude"],
      action: "uninstall",
      execute: true,
      approvalTimeoutMs: 600_000,
      hookTimeoutMs: 10_000,
      paths: tempPaths,
    });
    const updated = JSON.parse(readFileSync(tempPaths.manifestPath, "utf8")) as { providers: string[] };
    expect(updated.providers).toEqual(["codex"]);
  });
});

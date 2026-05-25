import { describe, expect, it } from "vitest";
import {
  addManagedHookEntries,
  codexHooksFeatureEnabled,
  enableCodexHooksFeature,
  managedHookCommand,
  removeManagedHookEntries,
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
});

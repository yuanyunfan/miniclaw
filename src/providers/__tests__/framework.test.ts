import { describe, expect, it } from "vitest";
import { categorizeProviderError, runProviderModuleAsPreProvider } from "../framework.js";
import type { ProviderModule } from "../framework.js";

describe("provider framework", () => {
  it("adapts lifecycle providers back to PreProviderResult and delays commits", async () => {
    const calls: string[] = [];
    const provider: ProviderModule<{ value: string }> = {
      manifest: {
        name: "test-provider",
        kind: "custom",
        privacy: "private",
        sideEffects: "state_commit_after_success",
        supportsDryRun: true,
        supportsHealthCheck: true,
        outputSchemaVersion: "test.v1",
      },
      async run(context) {
        calls.push(`run:${context.configName}`);
        return { value: context.jobName };
      },
      async format(result) {
        calls.push(`format:${result.value}`);
        return {
          text: result.value,
          commit: async () => {
            calls.push("formatted-commit");
          },
        };
      },
      async commit(result) {
        calls.push(`module-commit:${result.value}`);
      },
    };

    const result = await runProviderModuleAsPreProvider(provider, {
      configName: "fixture",
      jobName: "daily-test",
      channelId: "channel",
      runAt: new Date("2026-05-11T00:00:00.000Z"),
    });

    expect(result.text).toBe("daily-test");
    expect(calls).toEqual(["run:fixture", "format:daily-test"]);
    await result.commit?.();
    expect(calls).toEqual(["run:fixture", "format:daily-test", "formatted-commit", "module-commit:daily-test"]);
  });

  it("categorizes provider failures into stable taxonomy buckets", () => {
    expect(categorizeProviderError(new Error("session cookie expired"))).toBe("auth");
    expect(categorizeProviderError(new Error("stock-pulse provider config not found"))).toBe("config");
    expect(categorizeProviderError(new Error("ETIMEDOUT fetching quote"))).toBe("network");
    expect(categorizeProviderError(new Error("invalid payload shape from parser"))).toBe("format_drift");
  });
});

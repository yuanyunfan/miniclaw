import { describe, expect, it } from "vitest";
import { delimiter, join } from "node:path";
import { buildCronScriptEnv, buildCronScriptPath } from "../script-env.js";

describe("cron script env", () => {
  it("prepends active conda env before the inherited PATH", () => {
    const path = buildCronScriptPath({
      CONDA_PREFIX: "/opt/miniconda3",
      PATH: ["/opt/homebrew/bin", "/usr/bin"].join(delimiter),
    });

    expect(path?.split(delimiter).slice(0, 3)).toEqual([
      join("/opt/miniconda3", process.platform === "win32" ? "Scripts" : "bin"),
      "/opt/homebrew/bin",
      "/usr/bin",
    ]);
  });

  it("lets explicit cron path and python bin override conda path", () => {
    const path = buildCronScriptPath({
      MINICLAW_CRON_PATH_PREPEND: ["/custom/bin", "/other/bin"].join(delimiter),
      MINICLAW_CRON_PYTHON_BIN: "/python/bin/python3",
      CONDA_PREFIX: "/opt/miniconda3",
      PATH: ["/python/bin", "/usr/bin"].join(delimiter),
    });

    expect(path?.split(delimiter).slice(0, 5)).toEqual([
      "/custom/bin",
      "/other/bin",
      "/python/bin",
      join("/opt/miniconda3", process.platform === "win32" ? "Scripts" : "bin"),
      "/usr/bin",
    ]);
  });

  it("preserves cron metadata while normalizing PATH", () => {
    const env = buildCronScriptEnv(
      { MINICLAW_CRON_NAME: "daily", MINICLAW_CHANNEL_ID: "1000" },
      { CONDA_PREFIX: "/opt/miniconda3", PATH: "/usr/bin" },
    );

    expect(env.MINICLAW_CRON_NAME).toBe("daily");
    expect(env.MINICLAW_CHANNEL_ID).toBe("1000");
    expect(env.PATH?.split(delimiter)[0]).toBe(
      join("/opt/miniconda3", process.platform === "win32" ? "Scripts" : "bin"),
    );
  });
});

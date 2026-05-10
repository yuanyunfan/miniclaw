import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CRON_CLI_SCRIPTS = [
  "scripts/cron-test.ts",
  "scripts/cron-trigger-all.ts",
];

describe("cron CLI scripts", () => {
  it("use the minimal cron runner client instead of the full Discord bot", () => {
    for (const file of CRON_CLI_SCRIPTS) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("createCronRunnerClient");
      expect(source).not.toContain("../src/bot.js");
      expect(source).not.toContain("createBot");
    }
  });
});

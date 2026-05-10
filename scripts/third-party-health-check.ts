#!/usr/bin/env tsx
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatThirdPartyHealthIssueReport,
  runThirdPartyHealthCheck,
} from "../src/ops/third-party-health.js";

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const report = await runThirdPartyHealthCheck();
  if (hasArg("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const message = formatThirdPartyHealthIssueReport(report);
  if (!message) return;

  const dir = mkdtempSync(join(tmpdir(), "miniclaw-third-party-health-"));
  const path = join(dir, "summary.md");
  writeFileSync(path, message, "utf8");
  console.log(`DISCORD_MESSAGE:${path}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});

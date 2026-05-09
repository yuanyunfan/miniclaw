#!/usr/bin/env tsx
import { parseSafeRestartArgs, runSafeRestart } from "../src/ops/safe-restart.js";

try {
  const args = parseSafeRestartArgs(process.argv.slice(2));
  const result = await runSafeRestart(args);
  process.exit(result.exitCode);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`safe-restart error: ${message}\n`);
  process.exit(2);
}

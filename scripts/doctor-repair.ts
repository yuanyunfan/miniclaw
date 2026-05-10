#!/usr/bin/env tsx
import {
  formatDoctorRepairResult,
  parseDoctorRepairArgs,
  runDoctorRepair,
} from "../src/ops/doctor-repair.js";
import { initDb } from "../src/store/db.js";

try {
  const args = parseDoctorRepairArgs(process.argv.slice(2));
  initDb();
  const result = await runDoctorRepair(args);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(formatDoctorRepairResult(result) + "\n");
  }
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`doctor-repair error: ${message}\n`);
  process.exit(2);
}

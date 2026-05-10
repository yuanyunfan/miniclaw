#!/usr/bin/env tsx
import { formatDoctorReport, parseDoctorArgs, runDoctor } from "../src/ops/doctor.js";

try {
  const args = parseDoctorArgs(process.argv.slice(2));
  const report = await runDoctor(args);
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatDoctorReport(report) + "\n");
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`doctor error: ${message}\n`);
  process.exit(2);
}

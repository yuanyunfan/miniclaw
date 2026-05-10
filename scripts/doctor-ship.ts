#!/usr/bin/env tsx
import {
  formatDoctorShipResult,
  parseDoctorShipArgs,
  runDoctorShip,
} from "../src/ops/doctor-ship.js";
import { initDb } from "../src/store/db.js";

try {
  const args = parseDoctorShipArgs(process.argv.slice(2));
  initDb();
  const result = await runDoctorShip(args);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(formatDoctorShipResult(result) + "\n");
  }
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`doctor-ship error: ${message}\n`);
  process.exit(2);
}

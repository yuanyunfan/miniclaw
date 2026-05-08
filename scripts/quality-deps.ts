#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";

execFileSync("pnpm", ["audit", "--prod", "--audit-level", "high"], { stdio: "inherit" });
console.log("Dependency scan passed: no high or critical production advisories.");

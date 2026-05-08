#!/usr/bin/env tsx
import { execFileSync, spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const staged = args.has("--staged");
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(repoRoot);

function hasCommand(name: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v ${name}`], { stdio: "ignore" });
  return result.status === 0;
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
}

if (hasCommand("gitleaks")) {
  if (staged) {
    run("gitleaks", ["protect", "--staged", "--redact", "--no-banner"]);
  } else {
    run("gitleaks", ["detect", "--source", repoRoot, "--redact", "--no-banner"]);
  }
  console.log(`Secret scan passed with gitleaks (${staged ? "staged" : "tree"}).`);
} else {
  if (process.env.MINICLAW_REQUIRE_GITLEAKS === "1") {
    throw new Error("gitleaks is required but was not found in PATH");
  }
  console.warn("gitleaks not found; falling back to MiniClaw G0 high-confidence secret checks.");
  run("pnpm", ["run", staged ? "quality:g0:staged" : "quality:g0"]);
}

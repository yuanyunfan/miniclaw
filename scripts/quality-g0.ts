#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

type ScanMode = "staged" | "tree";

interface Finding {
  path: string;
  reason: string;
}

const args = new Set(process.argv.slice(2));
const mode: ScanMode = args.has("--staged") ? "staged" : "tree";
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(repoRoot);

const MAX_TEXT_SCAN_BYTES = 2_000_000;
const LARGE_TEXT_ALLOWLIST = new Set(["pnpm-lock.yaml"]);

function gitBuffer(command: string[]): Buffer {
  return execFileSync("git", command, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
}

function gitText(command: string[]): string {
  return execFileSync("git", command, { cwd: repoRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

function splitZero(buffer: Buffer): string[] {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function selectedPaths(): string[] {
  if (mode === "staged") {
    return splitZero(gitBuffer(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]));
  }
  return splitZero(gitBuffer(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
}

function stagedFileSize(path: string): number {
  return Number(gitText(["cat-file", "-s", `:${path}`]).trim());
}

function fileSize(path: string): number {
  return mode === "staged" ? stagedFileSize(path) : statSync(path).size;
}

function fileContent(path: string): Buffer {
  return mode === "staged" ? gitBuffer(["show", `:${path}`]) : readFileSync(path);
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}

function linePreview(text: string, index: number): string {
  const before = text.lastIndexOf("\n", index);
  const after = text.indexOf("\n", index);
  return text.slice(before + 1, after === -1 ? undefined : after).trim().slice(0, 180);
}

function blockedPathReason(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const name = basename(normalized);
  const ext = extname(name).toLowerCase();

  if (normalized.startsWith("docs/private/")) return "docs/private is intentionally ignored and must not be committed";
  if (normalized.startsWith("docs/zh/")) return "docs/zh is a local review-copy directory and must not be committed";
  if (normalized.startsWith(".miniclaw/") || normalized.includes("/.miniclaw/")) return "local .miniclaw runtime data must stay outside git";
  if (normalized.startsWith(".playwright-mcp/")) return "Playwright MCP runtime snapshots must not be committed";
  if (normalized.startsWith(".miniclaw-attachments/")) return "MiniClaw attachment cache must not be committed";
  if (normalized === "scripts/.channel-map.json") return "Discord channel map is local private configuration";
  if (normalized.startsWith("coverage/")) return "coverage output must not be committed";
  if (normalized.startsWith("artifacts/e2e/")) return "E2E artifacts may contain transcripts or logs and must stay outside git by default";

  if (name === ".env" || (/^\.env\./.test(name) && name !== ".env.example")) {
    return "environment files commonly contain secrets";
  }
  if ([".db", ".sqlite", ".sqlite3", ".p12", ".pfx", ".pem", ".key"].includes(ext)) {
    return `${ext} files commonly contain private data or credentials`;
  }
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/.test(name) && !name.endsWith(".pub")) {
    return "private SSH key filename detected";
  }
  return undefined;
}

const secretPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: "private key block", pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/g },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { name: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    name: "Discord webhook",
    pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,22}\/[A-Za-z0-9_-]{50,}/g,
  },
  {
    name: "hard-coded secret env assignment",
    pattern: /(?<!\.)\b(?:DISCORD_TOKEN|DISCORD_WEBHOOK|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GITHUB_PAT|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?(?!process\.env\b)[A-Za-z0-9_./+=-]{16,}/gi,
  },
];

function secretFinding(path: string, buffer: Buffer): string | undefined {
  if (isBinary(buffer)) return "binary file detected";
  const text = buffer.toString("utf8");
  for (const item of secretPatterns) {
    item.pattern.lastIndex = 0;
    const match = item.pattern.exec(text);
    if (!match) continue;
    const preview = linePreview(text, match.index);
    if (/\[redacted]|placeholder|example|dummy|fake|test-token|your_/i.test(preview)) continue;
    return `${item.name}: ${preview}`;
  }
  return undefined;
}

function publicExampleFinding(path: string, buffer: Buffer): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const isPublicDoc = normalized.startsWith("docs/") && !normalized.startsWith("docs/private/");
  const isPublicExample = ["README.md", "README.en.md", "config.example.yaml"].includes(normalized);
  if (!isPublicDoc && !isPublicExample) return undefined;
  if (isBinary(buffer)) return undefined;

  const text = buffer.toString("utf8");
  if (text.includes("/Users/" + "yuan")) {
    return "public docs/examples must not contain machine-local user home paths";
  }
  if (/\b[1-9]\d{16,21}\b/.test(text)) {
    return "public docs/examples must not contain raw Discord snowflake IDs; use placeholders";
  }
  return undefined;
}

function packageDependencyFields(raw: string): string {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return JSON.stringify({
    dependencies: parsed.dependencies ?? {},
    devDependencies: parsed.devDependencies ?? {},
    optionalDependencies: parsed.optionalDependencies ?? {},
    peerDependencies: parsed.peerDependencies ?? {},
  });
}

function dependencyLockFinding(paths: string[]): Finding | undefined {
  if (mode !== "staged" || !paths.includes("package.json") || paths.includes("pnpm-lock.yaml")) return undefined;
  try {
    const staged = gitText(["show", ":package.json"]);
    const head = gitText(["show", "HEAD:package.json"]);
    if (packageDependencyFields(staged) !== packageDependencyFields(head)) {
      return {
        path: "package.json",
        reason: "dependency fields changed but pnpm-lock.yaml is not staged",
      };
    }
  } catch {
    return {
      path: "package.json",
      reason: "package.json is staged; stage pnpm-lock.yaml too if dependencies changed",
    };
  }
  return undefined;
}

function assertNodeVersion(findings: Finding[]): void {
  const raw = JSON.parse(readFileSync("package.json", "utf8")) as { engines?: { node?: string } };
  const required = raw.engines?.node?.match(/>=\s*(\d+)/)?.[1];
  if (!required) return;
  const actualMajor = Number(process.versions.node.split(".")[0]);
  const requiredMajor = Number(required);
  if (actualMajor < requiredMajor) {
    findings.push({
      path: "package.json",
      reason: `Node ${process.versions.node} does not satisfy engines.node ${raw.engines?.node}`,
    });
  }
}

const paths = selectedPaths();
const findings: Finding[] = [];
assertNodeVersion(findings);

for (const path of paths) {
  const pathReason = blockedPathReason(path);
  if (pathReason) {
    findings.push({ path, reason: pathReason });
    continue;
  }
  if (mode === "tree" && !existsSync(path)) continue;
  const size = fileSize(path);
  if (size > MAX_TEXT_SCAN_BYTES && !LARGE_TEXT_ALLOWLIST.has(path)) {
    findings.push({ path, reason: `file is larger than ${MAX_TEXT_SCAN_BYTES} bytes` });
    continue;
  }
  const content = fileContent(path);
  const publicExampleReason = publicExampleFinding(path, content);
  if (publicExampleReason) {
    findings.push({ path, reason: publicExampleReason });
    continue;
  }
  const reason = secretFinding(path, content);
  if (reason) findings.push({ path, reason });
}

const lockFinding = dependencyLockFinding(paths);
if (lockFinding) findings.push(lockFinding);

if (findings.length) {
  console.error(`G0 safety check failed in ${mode} mode:`);
  for (const finding of findings) {
    console.error(`- ${finding.path}: ${finding.reason}`);
  }
  process.exit(1);
}

const scope = mode === "staged" ? `${paths.length} staged file(s)` : `${paths.length} tracked/untracked file(s)`;
console.log(`G0 safety check passed (${scope}).`);

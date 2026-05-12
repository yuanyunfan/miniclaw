export type CommandRunner = (cmd: string, args: string[], cwd: string) => string;

export interface VerificationResult {
  command: string;
  ok: boolean;
  output: string;
  durationMs?: number;
}

export type VerificationCommand = [cmd: string, args: string[]];

function normalizeRepoPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasTestSuffix(path: string): boolean {
  return /(?:^|\/)__tests__\/.*\.(?:test|spec)\.ts$/.test(path) || /\.(?:test|spec)\.ts$/.test(path);
}

export function selectTargetedTestCommands(paths: string[]): VerificationCommand[] {
  const normalizedPaths = paths.map(normalizeRepoPath);
  const directTestFiles = normalizedPaths.filter(hasTestSuffix).sort();
  if (directTestFiles.length) {
    return [["pnpm", ["exec", "vitest", "run", ...directTestFiles]]];
  }

  const targets = new Set<string>();
  for (const path of normalizedPaths) {
    if (path.startsWith("src/routing/")) targets.add("src/routing/__tests__");
    else if (path.startsWith("src/discord/")) targets.add("src/discord/__tests__");
    else if (path.startsWith("src/cron/")) targets.add("src/cron/__tests__");
    else if (path.startsWith("src/ops/")) targets.add("src/ops/__tests__");
    else if (path.startsWith("src/store/")) targets.add("src/store/__tests__");
    else if (path.startsWith("src/agent/")) targets.add("src/agent/__tests__");
    else {
      const provider = path.match(/^src\/providers\/([^/]+)\//)?.[1];
      const mcp = path.match(/^src\/mcp\/([^/]+)\//)?.[1];
      if (provider) targets.add(`src/providers/${provider}/__tests__`);
      if (mcp) targets.add(`src/mcp/${mcp}/__tests__`);
    }
  }

  return targets.size ? [["pnpm", ["exec", "vitest", "run", ...[...targets].sort()]]] : [];
}

export function repairVerificationCommands(changedFiles: string[]): VerificationCommand[] {
  return [
    ["pnpm", ["run", "quality:g0"]],
    ["pnpm", ["run", "quality:secrets"]],
    ...selectTargetedTestCommands(changedFiles),
    ["pnpm", ["run", "typecheck"]],
    ["pnpm", ["run", "lint"]],
    ["pnpm", ["test"]],
    ["pnpm", ["run", "build"]],
  ];
}

export function runVerification(path: string, changedFiles: string[], run: CommandRunner): VerificationResult[] {
  const results: VerificationResult[] = [];
  for (const [cmd, args] of repairVerificationCommands(changedFiles)) {
    const label = [cmd, ...args].join(" ");
    const startedAt = Date.now();
    try {
      const output = run(cmd, args, path);
      results.push({ command: label, ok: true, output: output.slice(-4000), durationMs: Date.now() - startedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ command: label, ok: false, output: message.slice(-4000), durationMs: Date.now() - startedAt });
      break;
    }
  }
  return results;
}

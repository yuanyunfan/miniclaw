import { delimiter, dirname, join } from "node:path";

function splitPath(value: string | undefined): string[] {
  return value ? value.split(delimiter).filter(Boolean) : [];
}

function dedupePath(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    result.push(part);
  }
  return result;
}

function condaBinDir(prefix: string): string {
  return join(prefix, process.platform === "win32" ? "Scripts" : "bin");
}

export function buildCronScriptPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const existing = env.PATH ?? env.Path ?? env.path;
  const prepend = [
    ...splitPath(env.MINICLAW_CRON_PATH_PREPEND),
    ...(env.MINICLAW_CRON_PYTHON_BIN ? [dirname(env.MINICLAW_CRON_PYTHON_BIN)] : []),
    ...(env.CONDA_PREFIX ? [condaBinDir(env.CONDA_PREFIX)] : []),
  ];
  const merged = dedupePath([...prepend, ...splitPath(existing)]);
  return merged.length ? merged.join(delimiter) : undefined;
}

export function buildCronScriptEnv(
  extra: NodeJS.ProcessEnv,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base, ...extra };
  const path = buildCronScriptPath(env);
  if (path) env.PATH = path;
  return env;
}

import type { PreProviderRunArgs } from "../src/providers/types.js";
import {
  getProviderManifest,
  isPreProviderName,
  listPreProviderNames,
  runProviderHealthCheck,
} from "../src/providers/index.js";

interface ProviderHealthCliArgs {
  provider?: string;
  configName?: string;
  all: boolean;
  json: boolean;
  help: boolean;
}

interface ProviderHealthCliReport {
  provider: string;
  supported: boolean;
  manifest?: ReturnType<typeof getProviderManifest>;
  ok?: boolean;
  category?: string;
  message: string;
  checkedAt?: string;
  safeDetails?: Record<string, unknown>;
}

function parseArgs(argv: string[]): ProviderHealthCliArgs {
  const parsed: ProviderHealthCliArgs = { all: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--all") parsed.all = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--provider") {
      parsed.provider = argv[i + 1];
      i += 1;
    } else if (arg === "--config") {
      parsed.configName = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm provider:health -- --provider stock-pulse --config us-hourly",
    "  pnpm provider:health -- --all --json",
  ].join("\n");
}

function cliRunArgs(options: ProviderHealthCliArgs, provider: string): PreProviderRunArgs {
  return {
    configName: options.configName,
    jobName: `provider-health:${provider}`,
    channelId: "provider-health-cli",
    runAt: new Date(),
  };
}

async function checkProvider(provider: string, options: ProviderHealthCliArgs): Promise<ProviderHealthCliReport> {
  const manifest = getProviderManifest(provider);
  if (!manifest?.supportsHealthCheck) {
    return {
      provider,
      supported: false,
      manifest,
      message: "health check is not implemented",
    };
  }
  const result = await runProviderHealthCheck(provider, cliRunArgs(options, provider));
  return {
    provider,
    supported: true,
    manifest,
    ok: result.ok,
    category: result.category,
    message: result.message,
    checkedAt: result.checkedAt,
    safeDetails: result.safeDetails,
  };
}

function printText(reports: ProviderHealthCliReport[]): void {
  for (const report of reports) {
    const status = report.supported ? (report.ok ? "ok" : "fail") : "unsupported";
    const category = report.category ? ` category=${report.category}` : "";
    console.log(`${report.provider}: ${status}${category} - ${report.message}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.all && !options.provider) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const names = options.all ? listPreProviderNames() : [options.provider as string];
  for (const name of names) {
    if (!isPreProviderName(name)) throw new Error(`unknown pre_provider: ${name}`);
  }

  const reports = [];
  for (const name of names) {
    reports.push(await checkProvider(name, options));
  }

  if (options.json) console.log(JSON.stringify(reports, null, 2));
  else printText(reports);

  process.exitCode = reports.some((report) => report.supported && report.ok === false) ? 1 : 0;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});

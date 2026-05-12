import type { PreProviderRunArgs } from "../src/providers/types.js";
import {
  getProviderManifest,
  isPreProviderName,
  runProviderDryRun,
} from "../src/providers/index.js";

interface ProviderDryRunCliArgs {
  provider?: string;
  configName?: string;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ProviderDryRunCliArgs {
  const parsed: ProviderDryRunCliArgs = { json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") parsed.help = true;
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
    "  pnpm provider:dry-run -- --provider stock-pulse --config us-hourly",
    "  pnpm provider:dry-run -- --provider stock-pulse --config us-hourly --json",
  ].join("\n");
}

function cliRunArgs(options: ProviderDryRunCliArgs, provider: string): PreProviderRunArgs {
  return {
    configName: options.configName,
    jobName: `provider-dry-run:${provider}`,
    channelId: "provider-dry-run-cli",
    runAt: new Date(),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.provider) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (!isPreProviderName(options.provider)) throw new Error(`unknown pre_provider: ${options.provider}`);

  const manifest = getProviderManifest(options.provider);
  if (!manifest?.supportsDryRun) {
    throw new Error(`provider ${options.provider} does not support dry-run`);
  }
  const result = await runProviderDryRun(options.provider, cliRunArgs(options, options.provider));
  const report = {
    provider: options.provider,
    manifest,
    ...result,
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(result.previewText ?? JSON.stringify(result.structured ?? report, null, 2));
  }
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});

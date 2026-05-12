import type { PreProviderResult, PreProviderRunArgs } from "./types.js";

export type ProviderKind = "email" | "stock" | "wechat" | "web" | "custom";
export type ProviderPrivacy = "public" | "private" | "sensitive";
export type ProviderSideEffects = "none" | "state_commit_after_success";

export interface ProviderManifest {
  name: string;
  kind: ProviderKind;
  privacy: ProviderPrivacy;
  sideEffects: ProviderSideEffects;
  supportsDryRun: boolean;
  supportsHealthCheck: boolean;
  outputSchemaVersion: string;
}

export interface ProviderContext {
  jobName: string;
  channelId: string;
  configName?: string;
  runAt: Date;
}

export type ProviderFailureCategory =
  | "auth"
  | "network"
  | "data_absence"
  | "format_drift"
  | "provider_bug"
  | "config"
  | "third_party";

export interface ProviderHealthResult {
  ok: boolean;
  category?: ProviderFailureCategory;
  message: string;
  checkedAt: string;
  safeDetails?: Record<string, unknown>;
}

export interface ProviderDryRunResult<TStructured = unknown> {
  ok: boolean;
  category?: ProviderFailureCategory;
  structured?: TStructured;
  previewText?: string;
  redacted: boolean;
  warnings: string[];
}

export interface ProviderModule<TStructured = unknown> {
  manifest: ProviderManifest;
  healthCheck?(context: ProviderContext): Promise<ProviderHealthResult>;
  dryRun?(context: ProviderContext): Promise<ProviderDryRunResult>;
  run(context: ProviderContext): Promise<TStructured>;
  format(result: TStructured, context: ProviderContext): Promise<PreProviderResult>;
  commit?(result: TStructured, context: ProviderContext): Promise<void>;
}

export function providerContextFromPreProviderArgs(args: PreProviderRunArgs): ProviderContext {
  return {
    configName: args.configName,
    jobName: args.jobName,
    channelId: args.channelId,
    runAt: args.runAt,
  };
}

export async function runProviderModuleAsPreProvider<TStructured>(
  provider: ProviderModule<TStructured>,
  args: PreProviderRunArgs,
): Promise<PreProviderResult> {
  const context = providerContextFromPreProviderArgs(args);
  const structured = await provider.run(context);
  const formatted = await provider.format(structured, context);
  if (!provider.commit) return formatted;
  const formattedCommit = formatted.commit;
  return {
    ...formatted,
    commit: async () => {
      if (formattedCommit) await formattedCommit();
      await provider.commit?.(structured, context);
    },
  };
}

export function safeProviderErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(validatekey=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(password|token|cookie|secret|session|account|customer|acc_id)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

export function categorizeProviderError(err: unknown): ProviderFailureCategory {
  const message = safeProviderErrorMessage(err).toLowerCase();
  if (/(auth|login|unauthori[sz]ed|forbidden|session|credential|cookie|token)/.test(message)) return "auth";
  if (/(config|yaml|json|schema|required|not found|reserved|invalid .*name)/.test(message)) return "config";
  if (/(econn|enotfound|etimedout|timeout|network|dns|socket|fetch failed)/.test(message)) return "network";
  if (/(no data|empty|no new|absence|not enough data|returned no)/.test(message)) return "data_absence";
  if (/(parse|parser|format|drift|invalid payload|unexpected shape|malformed)/.test(message)) return "format_drift";
  if (/(429|rate limit|too many requests|503|502|upstream|third[- ]party|vendor|provider service)/.test(message)) return "third_party";
  return "provider_bug";
}

export function providerHealthFromError(err: unknown, checkedAt = new Date()): ProviderHealthResult {
  return {
    ok: false,
    category: categorizeProviderError(err),
    message: safeProviderErrorMessage(err),
    checkedAt: checkedAt.toISOString(),
  };
}

export function providerDryRunFromError<TStructured = unknown>(err: unknown): ProviderDryRunResult<TStructured> {
  const message = safeProviderErrorMessage(err);
  return {
    ok: false,
    category: categorizeProviderError(err),
    previewText: message,
    redacted: true,
    warnings: [message],
  };
}

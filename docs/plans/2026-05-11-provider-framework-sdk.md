# Provider Framework SDK

Status: draft
Date: 2026-05-11

## Background

MiniClaw's provider contract is currently centered on `PreProviderResult`: provider text, optional attachments, optional `skipTask`, and optional `commit()` after downstream task success.

That contract is enough for current cron pre-context, but providers have evolved unevenly. WeChat, email, Futu, Eastmoney, stock portfolio, stock pulse, and market-intel providers each have pieces of config, collection, formatting, redaction, health-like checks, and fixture behavior, but there is no shared manifest, health check, dry-run, structured output, replay fixture, or failure taxonomy.

This matters because cron failures, Auto Doctor, and zero-touch reports need to distinguish auth/session problems, no new data, network errors, format drift, and provider bugs before deciding whether to trigger an LLM task or repair flow.

## Goals

- Define a provider manifest and lifecycle contract.
- Add provider health check and dry-run entry points.
- Support structured output before prompt formatting.
- Add a common failure taxonomy.
- Add replay fixtures and redaction tests for new providers.
- Pilot the framework with one low-risk provider before migrating all providers.

## Non-Goals

- Do not rewrite every provider in the first slice.
- Do not remove `PreProviderResult` compatibility.
- Do not expose private provider payloads to Discord or LLM prompts by default.
- Do not trigger side effects during health check or dry-run.
- Do not treat data providers as AI model providers.

## Existing Architecture Evidence

- `src/providers/types.ts`: current `PreProviderRunArgs`, `PreProviderAttachment`, `PreProviderResult`, and `PreProviderRunner`.
- `src/providers/index.ts`: provider registry.
- `src/cron/runner-task.ts`: runs `pre_provider`, injects provider text into the task prompt, handles attachments and `skipTask`, and calls `commit()` only after task success.
- Existing providers:
  - `src/providers/stock-portfolio/*`
  - `src/providers/stock-pulse/*`
  - `src/providers/market-intel/*`
  - `src/providers/wechat-mp/*`
  - `src/providers/email-query/*`
  - `src/providers/cmb-credit-card-email/*`
  - `src/providers/eastmoney-jywg-readonly/*`
  - `src/providers/futu-stock/*`
- `docs/plans/2026-05-10-market-intel-pre-market-research.md`: structured evidence direction.
- `docs/continuous-improvement-report.md`: provider framework gap and manifest sketch.

## Proposed Manifest

```ts
export interface ProviderManifest {
  name: string;
  kind: "email" | "stock" | "wechat" | "web" | "custom";
  privacy: "public" | "private" | "sensitive";
  sideEffects: "none" | "state_commit_after_success";
  supportsDryRun: boolean;
  supportsHealthCheck: boolean;
  outputSchemaVersion: string;
}
```

## Proposed Lifecycle Contract

```ts
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
  dryRun?(context: ProviderContext): Promise<ProviderDryRunResult<TStructured>>;
  run(context: ProviderContext): Promise<TStructured>;
  format(result: TStructured, context: ProviderContext): Promise<PreProviderResult>;
  commit?(result: TStructured, context: ProviderContext): Promise<void>;
}
```

Keep adapters to produce existing `PreProviderResult` until cron runner is migrated.

## Pilot Provider Choice

Start with `stock-pulse` or `stock-portfolio`, not `market-intel`.

Recommended pilot: `stock-pulse`.

Reason:

- It is already more deterministic than web/news-heavy market-intel.
- It uses public market data and structured quote/anomaly concepts.
- It already has provider tests.
- Health/dry-run can be defined without touching private account data first.

After the pilot, adapt one private/sensitive provider such as `email-query` or `eastmoney-jywg-readonly` to prove redaction and auth failure handling.

## Implementation Plan

1. Add framework types.
   - New file: `src/providers/framework.ts` or `src/providers/sdk.ts`.
   - Include manifest, lifecycle, failure taxonomy, and adapter helpers.
2. Add registry metadata.
   - Extend `src/providers/index.ts` to expose manifests.
   - Keep existing `isPreProviderName` and runner lookup stable.
3. Add compatibility adapter.
   - `runProviderAsPreProvider(name, args)`:
     - if provider implements new lifecycle, call `run()` then `format()`;
     - wrap `commit()` so it still runs only after downstream task success;
     - preserve `skipTask`.
   - Existing providers can continue as `PreProviderRunner`.
4. Implement pilot provider.
   - Add `manifest`, `healthCheck`, `dryRun`, `run`, and `format` around current `stock-pulse` logic.
   - Keep existing exported `runStockPulseProvider(args)` as compatibility.
5. Add provider health CLI.
   - Candidate script: `scripts/provider-health.ts`.
   - Package script: `"provider:health": "tsx scripts/provider-health.ts"`.
   - Usage:
     - `pnpm provider:health -- --provider stock-pulse --config us-hourly`
     - `pnpm provider:health -- --all --json`
6. Add provider dry-run CLI.
   - Candidate script: `scripts/provider-dry-run.ts`.
   - Package script: `"provider:dry-run": "tsx scripts/provider-dry-run.ts"`.
   - Must default to redacted output.
7. Update cron preflight path.
   - For providers that support health check, optionally run health/dry-run before triggering the downstream LLM task.
   - First slice can expose CLI only; cron integration can be a later slice if risk is high.
8. Add fixtures.
   - Recommended structure:
     - `src/providers/<provider>/fixtures/*.json`
     - `src/providers/<provider>/__tests__/fixtures.test.ts`
   - Cover replay, format drift, redaction, and no-data behavior.
9. Add docs.
   - New feature doc candidate: `docs/features/15-provider-framework.md`.
   - Include provider author checklist.

## Provider Author Checklist

Every new provider should specify:

- manifest values
- config schema and defaults
- health check behavior
- dry-run behavior
- structured output schema/version
- formatter output shape
- redaction rules
- fixture coverage
- `commit()` side effects and when they are allowed
- known failure categories

## Verification Plan

- Focused:
  - `pnpm vitest run src/providers/stock-pulse`
  - Add new framework tests.
  - Add provider health/dry-run script tests if pure functions are extracted.
- Static:
  - `pnpm run typecheck`
  - `pnpm run lint`
- Cron regression if cron runner changes:
  - `pnpm run e2e:cron`
- Full:
  - `pnpm test`
  - `pnpm run build`

## Risks And Rollback

- Risk: framework becomes too abstract before enough providers use it.
  - Mitigation: pilot one provider and keep `PreProviderRunner` compatibility.
- Risk: health check accidentally triggers side effects.
  - Mitigation: manifest `sideEffects` and tests; health/dry-run must not call `commit()`.
- Risk: private provider data leaks in dry-run.
  - Mitigation: redacted output default, provider privacy level, fixture redaction tests.
- Risk: cron preflight changes production behavior.
  - Mitigation: land CLI and framework first; add cron preflight behind config in a later slice.

## Documentation Sync

- Add `docs/features/15-provider-framework.md`.
- Update `docs/README.md` feature index.
- Update `docs/architecture.md` provider/cron section.
- Update `docs/quality-gates.md` if new provider fixture requirements become a gate.
- Run `pnpm run quality:docs`.

## Execution Notes

Record pilot provider, manifest fields, CLI commands, cron integration state, and verification output here when implemented.


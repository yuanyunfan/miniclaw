# Provider Framework SDK

状态：`draft`
日期：2026-05-11

## 背景

MiniClaw 的 provider contract 目前以 `PreProviderResult` 为中心：provider text、optional attachments、optional `skipTask`，以及下游 task 成功后的 optional `commit()`。

这个 contract 对当前 cron pre-context 已经足够，但 providers 的演进并不均匀。WeChat、email、Futu、Eastmoney、stock portfolio、stock pulse 和 market-intel providers 各自都有部分 config、collection、formatting、redaction、类似 health 的 checks 和 fixture behavior，但没有共享 manifest、health check、dry-run、structured output、replay fixture 或 failure taxonomy。

这很重要，因为 cron failures、Auto Doctor 和 zero-touch reports 需要先区分 auth/session problems、no new data、network errors、format drift 和 provider bugs，才能决定是否触发 LLM task 或 repair flow。

## 目标

- 定义 provider manifest 和 lifecycle contract。
- 增加 provider health check 和 dry-run entry points。
- 支持 prompt formatting 前的 structured output。
- 增加 common failure taxonomy。
- 为新 providers 增加 replay fixtures 和 redaction tests。
- 先用一个低风险 provider 试点 framework，再迁移所有 providers。

## 非目标

- 第一阶段不重写所有 provider。
- 不移除 `PreProviderResult` compatibility。
- 默认不向 Discord 或 LLM prompts 暴露 private provider payloads。
- health check 或 dry-run 不触发 side effects。
- 不把 data providers 当成 AI model providers。

## 现有架构证据

- `src/providers/types.ts`：当前 `PreProviderRunArgs`、`PreProviderAttachment`、`PreProviderResult` 和 `PreProviderRunner`。
- `src/providers/index.ts`：provider registry。
- `src/cron/runner-task.ts`：运行 `pre_provider`，把 provider text 注入 task prompt，处理 attachments 和 `skipTask`，并且只在 task success 后调用 `commit()`。
- 现有 providers：
  - `src/providers/stock-portfolio/*`
  - `src/providers/stock-pulse/*`
  - `src/providers/market-intel/*`
  - `src/providers/wechat-mp/*`
  - `src/providers/email-query/*`
  - `src/providers/cmb-credit-card-email/*`
  - `src/providers/eastmoney-jywg-readonly/*`
  - `src/providers/futu-stock/*`
- `docs/plans/2026-05-10-market-intel-pre-market-research.md`：structured evidence 方向。
- `docs/archive/2026-05-11-continuous-improvement-report.md`：provider framework gap 和 manifest sketch。

## 拟议 Manifest

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

## 拟议 Lifecycle Contract

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

在 cron runner 迁移前，保留 adapter 来产出现有 `PreProviderResult`。

## Pilot Provider 选择

从 `stock-pulse` 或 `stock-portfolio` 开始，不从 `market-intel` 开始。

推荐 pilot：`stock-pulse`。

原因：

- 它比 web/news-heavy market-intel 更确定。
- 它使用 public market data 和 structured quote/anomaly concepts。
- 它已经有 provider tests。
- Health/dry-run 可以先在不触及 private account data 的情况下定义。

完成 pilot 后，适配一个 private/sensitive provider，例如 `email-query` 或 `eastmoney-jywg-readonly`，以证明 redaction 和 auth failure handling。

## 实施计划

1. 增加 framework types。
   - 新文件：`src/providers/framework.ts` 或 `src/providers/sdk.ts`。
   - 包含 manifest、lifecycle、failure taxonomy 和 adapter helpers。
2. 增加 registry metadata。
   - 扩展 `src/providers/index.ts` 以暴露 manifests。
   - 保持现有 `isPreProviderName` 和 runner lookup 稳定。
3. 增加 compatibility adapter。
   - `runProviderAsPreProvider(name, args)`：
     - 如果 provider 实现新 lifecycle，则调用 `run()` 后再调用 `format()`；
     - 包裹 `commit()`，保证它仍只在 downstream task success 后运行；
     - 保留 `skipTask`。
   - 现有 providers 可以继续作为 `PreProviderRunner`。
4. 实现 pilot provider。
   - 围绕当前 `stock-pulse` logic 增加 `manifest`、`healthCheck`、`dryRun`、`run` 和 `format`。
   - 保持现有 exported `runStockPulseProvider(args)` 兼容。
5. 增加 provider health CLI。
   - 候选脚本：`scripts/provider-health.ts`。
   - Package script：`"provider:health": "tsx scripts/provider-health.ts"`。
   - Usage：
     - `pnpm provider:health -- --provider stock-pulse --config us-hourly`
     - `pnpm provider:health -- --all --json`
6. 增加 provider dry-run CLI。
   - 候选脚本：`scripts/provider-dry-run.ts`。
   - Package script：`"provider:dry-run": "tsx scripts/provider-dry-run.ts"`。
   - 必须默认 redacted output。
7. 更新 cron preflight path。
   - 对支持 health check 的 providers，在触发 downstream LLM task 前可选运行 health/dry-run。
   - 第一阶段可以只暴露 CLI；如果风险较高，cron integration 可以留到后续 slice。
8. 增加 fixtures。
   - 推荐结构：
     - `src/providers/<provider>/fixtures/*.json`
     - `src/providers/<provider>/__tests__/fixtures.test.ts`
   - 覆盖 replay、format drift、redaction 和 no-data behavior。
9. 增加 docs。
   - 新 feature doc candidate：`docs/features/15-provider-framework.md`。
   - 包含 provider author checklist。

## Provider Author Checklist

每个新 provider 都应说明：

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

## 验证计划

- Focused：
  - `pnpm vitest run src/providers/stock-pulse`
  - 增加新 framework tests。
  - 如果抽出 pure functions，增加 provider health/dry-run script tests。
- Static：
  - `pnpm run typecheck`
  - `pnpm run lint`
- 如果 cron runner 变化，运行 cron regression：
  - `pnpm run e2e:cron`
- Full：
  - `pnpm test`
  - `pnpm run build`

## 风险与回滚

- 风险：framework 在足够多 providers 使用前变得过于抽象。
  - 缓解：pilot 一个 provider，并保持 `PreProviderRunner` compatibility。
- 风险：health check 意外触发 side effects。
  - 缓解：manifest `sideEffects` 和 tests；health/dry-run 不能调用 `commit()`。
- 风险：private provider data 在 dry-run 中泄露。
  - 缓解：redacted output default、provider privacy level、fixture redaction tests。
- 风险：cron preflight 改变 production behavior。
  - 缓解：先落 CLI 和 framework；后续 slice 再把 cron preflight 放在 config 后面。

## 文档同步

- 增加 `docs/features/15-provider-framework.md`。
- 更新 `docs/README.md` feature index。
- 更新 `docs/architecture.md` provider/cron section。
- 如果新的 provider fixture requirements 成为 gate，更新 `docs/quality-gates.md`。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 pilot provider、manifest fields、CLI commands、cron integration state 和 verification output。


# MiniClaw Provider Framework SDK

> 结论：provider framework 给 cron pre-provider 增加 manifest、health check、dry-run、structured output 和 failure taxonomy，但保留现有 `PreProviderResult` 兼容层。当前已迁移 `stock-pulse` 和 `eastmoney-jywg-readonly`；cron runner 默认仍只调用 `runPreProvider()`，只有显式配置 `pre_provider_preflight` 才会先运行 health 或 dry-run gate。

## 范围

本框架只覆盖 data provider，不覆盖 Claude/Codex model provider。

当前落地的稳定入口：

- `src/providers/framework.ts`: provider manifest、context、health/dry-run result、failure taxonomy、lifecycle module 和 `PreProviderResult` adapter。
- `src/providers/index.ts`: legacy pre-provider registry、framework manifest registry、health/dry-run runner。
- `src/providers/stock-pulse/index.ts`: `stock-pulse` pilot provider module。
- `src/providers/eastmoney-jywg-readonly/index.ts`: sensitive broker provider module，覆盖 session health、redacted dry-run 和 delayed session persistence。
- `src/providers/stock-pulse/fixtures/*.json` / `src/providers/eastmoney-jywg-readonly/fixtures/*.json`: framework provider replay、no-data、format-drift fixture。
- `scripts/provider-health.ts`: provider health CLI。
- `scripts/provider-dry-run.ts`: provider dry-run CLI，默认只输出 redacted preview。
- `src/cron/loader.ts` / `src/cron/runner-task.ts`: opt-in cron preflight 配置解析和执行 gate。

## Contract

每个迁移后的 provider 应提供：

- `manifest`: 声明 provider 名称、领域、隐私等级、副作用边界、dry-run/health 能力和 output schema version。
- `healthCheck(context)`: 只做配置、session 或安全的可达性检查，不触发状态提交。
- `dryRun(context)`: 执行可观测预览，但默认输出 redacted result。
- `run(context)`: 生成结构化 provider output。
- `format(result, context)`: 把结构化 output 格式化为旧 cron prompt 可消费的 `PreProviderResult`。
- `commit(result, context)`: 仅在 downstream task 成功后由 adapter 调用。

## Compatibility Path

旧 provider 仍然可以只实现：

```ts
export type PreProviderRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;
```

迁移后的 provider 通过 `runProviderModuleAsPreProvider()` 适配回 `PreProviderResult`。这保证：

- cron `pre_provider` 配置不需要改。
- `skipTask`、attachments 和 prompt injection 行为继续由 cron runner 处理。
- provider `commit()` 仍只在 downstream LLM task 成功后执行。

## Cron Preflight

cron task 默认不启用 preflight。需要在已有 `pre_provider` job 上显式配置：

```yaml
pre_provider: stock-pulse
pre_provider_config: us-hourly
pre_provider_preflight: health   # off | health | dry_run
```

语义：

- 未配置或配置 `off`：保持旧行为，只执行 `runPreProvider()`。
- `health`：先执行 `runProviderHealthCheck()`。如果返回 `ok=false` 或 provider 不支持 health check，本次 cron 在采集 provider payload 和创建 downstream task 前失败，由现有 cron retry/alert 流程接管。
- `dry_run`：先执行 `runProviderDryRun()`。dry-run 输出只作为 redacted gate，不会拼进 prompt；通过后仍会执行真实 `runPreProvider()` 生成 prompt context。
- 不允许在没有 `pre_provider` 的 job 上配置 `pre_provider_preflight`。
- preflight 不改变 commit 语义：provider state/session commit 仍只在 downstream task 成功后执行。
- preflight 失败会携带 provider metadata 写入 `cron_runs`：`provider_name` 是配置的 `pre_provider`，`provider_status` 为 `health_failed` 或 `dry_run_failed`，`provider_category` / `error_category` 优先使用 framework failure taxonomy；provider 不支持对应 gate 时落为 `provider_preflight_failed`。真实 `runPreProvider()` 采集失败也会通过同一 taxonomy 写入 `provider_*` 字段，避免只留下 generic task-run error。

## Stock Pulse Pilot

`stock-pulse` 的 manifest：

- `kind`: `stock`
- `privacy`: `private`
- `sideEffects`: `state_commit_after_success`
- `supportsDryRun`: `true`
- `supportsHealthCheck`: `true`
- `outputSchemaVersion`: `stock-pulse.payload.v1`

Health check 当前只验证配置可加载，并返回安全摘要：profile、market scope、active window、open markets、symbol/source counts、quote provider settings。它不会查询 portfolio provider，也不会请求 Yahoo quote。

Dry-run 会实际执行 scan，但默认 preview 只返回 redacted summary：run context、universe counts、position/alert/failure/warning counts。它不会执行 nested provider commit。

## Eastmoney JYWG Sensitive Provider

`eastmoney-jywg-readonly` 的 manifest：

- `kind`: `stock`
- `privacy`: `sensitive`
- `sideEffects`: `state_commit_after_success`
- `supportsDryRun`: `true`
- `supportsHealthCheck`: `true`
- `outputSchemaVersion`: `eastmoney-jywg-readonly.payload.v1`

Health check 会加载 provider profile 和本地 session，并调用只读 `client.healthCheck()` 验证 session 可用性。返回内容只包含 profile、market session、redaction mode、include flags、host、cookie count 和 last verified time；不会输出 account alias、cookie value、session secret path 或原始 broker payload。

Dry-run 会执行一次只读 broker snapshot 采集和 formatter 前 structured payload 构建，但 preview 只输出 redacted summary：是否包含 report/snapshot/positions/asset summary、position/top-position/warning count 和 market session。即使 broker 返回 updated session，dry-run 也不会保存 session；只有兼容 adapter 返回的 `commit()` 在 downstream task 成功后才保存 updated session。

## Replay Fixtures

当前 fixture 覆盖已迁移的两个 framework provider：

- `src/providers/stock-pulse/fixtures/us-hourly-replay.json`: market-open replay，覆盖 portfolio/watchlist/universe scan、quote failure redaction、dry-run summary redaction 和 nested provider delayed commit。
- `src/providers/stock-pulse/fixtures/closed-market.json`: no-data gate，覆盖 market closed 时不查询 portfolio 或 quote source。
- `src/providers/eastmoney-jywg-readonly/fixtures/replay-summary.json`: sensitive broker replay，覆盖 health safe details、redacted dry-run、formatted prompt redaction 和 session delayed commit。
- `src/providers/eastmoney-jywg-readonly/fixtures/no-data.json`: no-position/no-asset warning state，覆盖 provider 不崩溃且只输出 redacted warning summary。
- `src/providers/eastmoney-jywg-readonly/fixtures/format-drift-error.json`: format drift failure taxonomy，覆盖 `format_drift` 分类和 token-like value redaction。

对应 tests：

- `src/providers/stock-pulse/__tests__/fixtures.test.ts`
- `src/providers/eastmoney-jywg-readonly/__tests__/fixtures.test.ts`

## CLI

```bash
pnpm provider:health -- --provider stock-pulse --config us-hourly
pnpm provider:health -- --provider eastmoney-jywg-readonly --config daily-stock-market
pnpm provider:health -- --all --json
pnpm provider:dry-run -- --provider stock-pulse --config us-hourly
pnpm provider:dry-run -- --provider eastmoney-jywg-readonly --config daily-stock-market
pnpm provider:dry-run -- --provider stock-pulse --config us-hourly --json
```

`provider:health --all` 会列出 legacy provider 的 unsupported 状态；只有已实现 framework health check 的 provider 会执行检查。`provider:dry-run` 当前要求指定单个 provider，且不提供未脱敏输出模式。

## Failure Taxonomy

统一 failure category：

- `auth`: 登录态、cookie、token、认证或授权失败。
- `network`: DNS、socket、timeout、fetch 等网络错误。
- `data_absence`: 没有新数据、空结果、数据不足。
- `format_drift`: parser、payload shape 或第三方页面/API 格式变化。
- `provider_bug`: provider 自身未分类 bug。
- `config`: 配置缺失、配置 schema 或 profile 名称错误。
- `third_party`: rate limit、上游 5xx 或第三方服务异常。

## Provider Author Checklist

新增或迁移 provider 时需要补齐：

- manifest values。
- config schema 和默认值。
- health check 行为与不会触发的副作用。
- dry-run 行为、redaction 规则和预览字段。
- structured output schema/version。
- formatter 输出 shape。
- replay fixture 和 focused provider tests，至少覆盖 replay、redaction、no-data；对第三方页面/API provider 还要覆盖 format drift 分类。
- `commit()` 的副作用和触发时机。
- failure category 映射。

## 验证

本阶段的 focused 验证：

```bash
pnpm vitest run src/providers/stock-pulse/__tests__/fixtures.test.ts src/providers/eastmoney-jywg-readonly/__tests__/fixtures.test.ts
pnpm vitest run src/cron/__tests__/loader.test.ts src/cron/__tests__/runner-task.test.ts
pnpm vitest run src/providers
pnpm vitest run src/providers/eastmoney-jywg-readonly/__tests__/framework.test.ts
pnpm run provider:health -- --provider stock-pulse --config __missing__
pnpm run typecheck
```

CLI 对真实本机 profile 的成功验证依赖 `~/.miniclaw/providers/<provider>/*.yaml` 是否存在。缺失 profile 应归类为 `config` failure，而不是 crash。

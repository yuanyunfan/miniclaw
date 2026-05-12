# MiniClaw Provider Framework SDK

> 结论：provider framework 给 cron pre-provider 增加 manifest、health check、dry-run、structured output 和 failure taxonomy，但保留现有 `PreProviderResult` 兼容层。本阶段已用 `stock-pulse` 作为 pilot；cron runner 仍只调用 `runPreProvider()`，不会因为本阶段改动改变生产调度行为。

## 范围

本框架只覆盖 data provider，不覆盖 Claude/Codex model provider。

当前落地的稳定入口：

- `src/providers/framework.ts`: provider manifest、context、health/dry-run result、failure taxonomy、lifecycle module 和 `PreProviderResult` adapter。
- `src/providers/index.ts`: legacy pre-provider registry、framework manifest registry、health/dry-run runner。
- `src/providers/stock-pulse/index.ts`: `stock-pulse` pilot provider module。
- `scripts/provider-health.ts`: provider health CLI。
- `scripts/provider-dry-run.ts`: provider dry-run CLI，默认只输出 redacted preview。

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

## CLI

```bash
pnpm provider:health -- --provider stock-pulse --config us-hourly
pnpm provider:health -- --all --json
pnpm provider:dry-run -- --provider stock-pulse --config us-hourly
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
- replay fixture 或 focused provider tests。
- `commit()` 的副作用和触发时机。
- failure category 映射。

## 验证

本阶段的 focused 验证：

```bash
pnpm vitest run src/providers
pnpm run provider:health -- --provider stock-pulse --config __missing__
pnpm run typecheck
```

CLI 对真实本机 profile 的成功验证依赖 `~/.miniclaw/providers/<provider>/*.yaml` 是否存在。缺失 profile 应归类为 `config` failure，而不是 crash。

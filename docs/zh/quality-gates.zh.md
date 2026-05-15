---
doc_id: quality-gates
lang: zh
translation_of: docs/quality-gates.md
translation_status: current
source_sha256: 71a8989681f3febb37c94dbfd79ba04bf0af766505c9b3a70c77b94632f78777
---
# MiniClaw Quality Gates

> MiniClaw 使用分层 gates：`L*` 验证行为，`G*` 阻止 unsafe commits/pushes，`D*` 阻止 documentation drift。真实 Discord E2E 已存在，但日常 gates 优先使用 deterministic fake/fixture path。真实网络和真实 LLM path 保留为 manual 或 scheduled。

## Current Baseline

`package.json` 暴露主要 gate entrypoints：

- `quality:g0`
- `quality:g0:staged`
- `quality:secrets`
- `quality:secrets:staged`
- `quality:changelog`
- `quality:docs`
- `quality:docs:drift`
- `quality:docs-i18n`
- `quality:website-docs`
- `quality:deps`
- `quality:coverage`
- `quality:commit`
- `quality:push`
- `e2e:cron`
- `e2e:discord`

`scripts/git-hooks/pre-commit` 调用 `pnpm run quality:commit`。`scripts/git-hooks/pre-push` 调用 `pnpm run quality:push`。CI 通过 `.github/workflows/quality.yml` 运行同类 gates。

## Naming Rules

- `L*` 表示 test layer：行为是否正确？
- `G*` 表示 quality gate：这次 commit、push 或 CI job 是否允许通过？
- `D*` 表示 docs gate：长期文档是否仍与实现一致？

不要混用这些概念。例如 `pnpm test` 是 `L1` test suite；只有 commit/push/CI entrypoint 调用它时，它才成为 `G1` gate 的一部分。

## G0: Repository Safety

目的：在错误进入 Git 前阻止高破坏性问题。

检查项包括：

- Node version 与 `package.json#engines` 兼容
- package 和 lockfile 一致
- staged 或 tree files 不包含 `.env`、SQLite DB、coverage HTML、大 binary、token dump 或本地 runtime artifacts
- public docs/examples 不包含本机 absolute paths 或 raw Discord snowflake IDs
- `docs/private/` 不进入 public docs 和 public website exposure
- `docs/zh/` 可作为 public docs 提交，但仍扫描 local paths、raw Discord IDs 和 secrets

运行位置：

- pre-commit
- CI
- 通过 `pnpm run quality:g0` 做 local tree verification

## G1: Static Correctness

目的：不接触真实外部系统，只验证代码可 typecheck、build、lint。

命令：

```bash
pnpm run typecheck
pnpm run build
pnpm run lint
```

项目特定 lint 期望：

- runtime source 应使用 `src/lib/log.ts`，而不是直接 `console.*`
- floating promises 必须显式且有理由
- logs 不得包含 secrets、full prompts、raw email bodies 或 token-like fields

运行位置：

- pre-commit：lint 和 typecheck
- pre-push：build 和 lint
- CI：typecheck、lint 和 build

## L1: Fast Unit And Component Tests

目的：deterministic、本地、无网络、无真实 Discord、无真实 LLM。

覆盖重点：

- cron loader、state、template、retry、scheduler pure logic
- routing intent、confirmation token、context handling
- Discord formatter、chunking、embeds、attachment conversion
- provider parser、formatter、redaction、health、dry run、fixtures
- prompt snapshot behavior
- task helper、session、usage、status summary logic

命令：

```bash
pnpm test
```

运行位置：

- pre-commit
- CI

## L2: Internal Integration Tests

目的：连接 MiniClaw modules，同时用 fakes 或 fixtures 替换外部系统。

示例：

- fake Discord channel/thread for task intake
- temporary SQLite DB for task state transitions
- fixture cron directory for scheduler and retry behavior
- fake slash interactions for command handlers
- fake pre-provider output injected into task prompts
- fake logger sink for start/end/error assertions

运行位置：

- pre-push
- CI

## L3: Real Discord E2E With Fake Agent

目的：验证真实 Discord Gateway、真实 channels、真实 threads 和真实 message output，但不调用 Claude/Codex。

规则：

- 使用 dedicated Discord test application
- 使用 dedicated test guild/channel
- 永远不要使用 production bot secrets
- fake agent 保持 deterministic
- manual 或 scheduled，不在每次 commit 跑

命令：

```bash
pnpm run e2e:discord
```

## L4: Real Provider Or Real LLM Smoke

目的：证明选定外部集成仍可工作。

示例：

- real Claude/Codex task smoke
- provider login/session refresh smoke
- real email/stock/content provider health check
- real Discord plus real LLM route

规则：

- 仅 manual 或 scheduled
- 使用 dedicated test channels/accounts
- traces 必须 redact
- 不让 volatile networks 阻塞普通 local pre-commit

## D1: Docs Drift

目的：防止 source changes 在没有 durable docs 更新的情况下落地。

`pnpm run quality:docs:drift` 检查：

- code 中 DB schema version 与 `docs/architecture.md` 记录一致
- `smart_router_decisions` documented fields 包含 `TEXT reason`、`TEXT matched_signals`、`TEXT risk_flags`、`TEXT capabilities_json`、`INTEGER classifier_elapsed_ms`、`TEXT classifier_error_type`、`TEXT classifier_error_message`、`TEXT user_choice`、`TEXT final_route`、`TEXT task_final_status`、`TEXT correction_type`、`TEXT correction_note` 和 `TEXT resolved_at`
- `docs/runtime/`、`docs/providers/`、`docs/experiments/` 下的 source docs 被 `docs/README.md` 索引
- changed source paths 通过 `src/quality/docs-drift.ts` 映射到 required docs

changed-path map 故意保守。source behavior 变化时，同一个 patch 必须包含相关 docs update。

## D2: Bilingual Docs Parity

目的：以 English 为 canonical source，保持 `docs/` 和 `docs/zh/` 对齐。

`pnpm run quality:docs-i18n` 检查：

- `docs/zh/**`、`docs/archive/**`、`docs/private/**` 之外的每个 tracked canonical doc 都出现在 `docs/documentation-migration-map.md`
- 每个 required source doc 都有 tracked Chinese mirror
- Chinese mirror frontmatter 包含 `doc_id`、`lang: zh`、`translation_of`、`translation_status` 和 `source_sha256`
- required docs 不允许 `translation_status: pending`
- current Chinese mirror 的 `source_sha256` 必须匹配 English source
- English canonical prose 在 fenced code blocks 外不含 CJK
- Chinese mirror prose 在 fenced code blocks 外必须包含 CJK
- tracked Chinese docs 必须在 migration map 中 paired
- heading level shape 必须匹配 English source

archive 和 private docs 默认排除在 required bilingual parity 外，除非 migration map 另行标记。

## D3: Website Docs Drift

目的：保持 GitHub Pages presentation content 与 canonical repo docs 绑定。

`pnpm run quality:website-docs` 检查 website frontmatter 和 `source_docs` references。website pages 只是 presentation layer；不能替代 `docs/` 作为 implementation source of truth。

## G2: Secrets And Dependencies

目的：阻止 secrets、unsafe local files 和 dependency issues。

命令：

```bash
pnpm run quality:secrets
pnpm run quality:deps
```

CI 也运行 gitleaks。

## Changelog Drift

目的：防止 release-visible changes 在没有更新 `CHANGELOG.md` 的情况下落地。

`pnpm run quality:changelog` 会在 release-visible paths 变化但同一 patch 未更新 `CHANGELOG.md` 时失败。release-visible paths 包括 `src/**`、`scripts/**`、`.github/workflows/**`、`docs/**`、`website/**`、`prompts/**`、`package.json`、`config.example.yaml` 和 public README files。archive/private docs、tests、fixtures、coverage 和 generated website output 会被忽略。

这个 gate 不自动生成 release notes。它把缺失 changelog update 变成 blocking，让 changelog 留在开发 workflow 内。

## Default Gate Entry Points

Pre-commit：

```bash
pnpm run quality:commit
```

Pre-push：

```bash
pnpm run quality:push
```

Targeted docs verification：

```bash
pnpm run quality:docs
```

Targeted i18n verification：

```bash
pnpm run quality:docs-i18n
```

Targeted changelog verification：

```bash
pnpm run quality:changelog
```

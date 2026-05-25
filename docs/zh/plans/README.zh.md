---
doc_id: plans-index
lang: zh
translation_of: docs/plans/README.md
translation_status: current
source_sha256: 0beb6ac42f51d591407a9ea3716fc0f916380d3ade228269bbd264929e40ebd9
---
# 发展计划文件

该目录存储了非三角迷你Claw变化的持久开发计划.

当任务改变架构,运行时行为,数据流,认证/许可,计划计划,crama,cron/producer/任务执行,Discord输出,Agent/Codex/Claude行为,Stage,或共享配置时,在编辑生产代码前使用计划文档.

## 当前规划说明

- [`2026-05-25-discord-agent-control-plane.md`](../../plans/2026-05-25-discord-agent-control-plane.md): draft design，覆盖通过 Discord mobile control Claude 或 Codex tasks，包括 task control events、live approvals、same-provider relay/resume 和 Codex app-server runtime。
- [`2026-05-17-stock-provider-data-layer-migration.md`](../../plans/2026-05-17-stock-provider-data-layer-migration.md): completed compatibility migration；stock providers 保持 cron-facing names，implementation 迁入 `src/stock/` source、data、signal 和 report layers。
- [`2026-05-15-documentation-strategy.md`](2026-05-15-documentation-strategy.md):完成;分层文件政策,`docs/`Docs-driving development source of truth, GitHub Pages 作为人造门户.

文件命名 :

```text
docs/plans/YYYY-MM-DD-short-slug.md
```

推荐模板 :

```markdown
# Title

Status: draft | in_progress | completed | superseded
Date: YYYY-MM-DD

## 背景

What problem is being solved, and which existing behavior matters?

## 目标

What must be true when this work is done?

## 非目标

What is intentionally out of scope?

## 现有架构证据

- Relevant files:
- Relevant commands:
- Relevant data/config:

## 实施计划

1. ...
2. ...
3. ...

## 验证计划

- Type check:
- Unit tests:
- Integration/E2E checks:
- Manual checks:

## 风险与回滚

- Risk:
- Mitigation:
- Rollback:

## 文档同步

- README:
- docs:
- CHANGELOG:

## 执行记录

Record material deviations from the plan and final verification evidence here.
```

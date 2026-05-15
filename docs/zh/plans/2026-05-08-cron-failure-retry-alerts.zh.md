---
doc_id: cron-failure-retry-alerts-plan
lang: zh
translation_of: docs/plans/2026-05-08-cron-failure-retry-alerts.md
translation_status: current
source_sha256: b4c863df24ef6992e0b0c214f28bdd78d4d37b417800f08684d2df5ba4b728cb
---
# Cron 失败重试提醒

现况:已完成
日期:2026-05-08

## 背景情况

MiniClaw cron 任务已经在调度层重试:一次失败的预定运行重试最多5次,总尝试为10米,20米,40米,80米反转. 缺少的作品是预定任务失败时Discord的能见度,加上允许用户立即从该失败消息中重试的安全方式.

## 目标

1. 在预定的曲折尝试失败时发送简短的Discord故障摘要.
2. 包含一个按钮,允许允许用户立即重试同一失败的 cron 任务 。
3. 尽可能通过重试对同样的故障信息进行编辑,避免提醒垃圾邮件。
4. 如果以后自动重试成功,则编辑故障警报,使其恢复状态,并删除按钮。
5. 保持Discord按钮有效载荷不敏感:只有随机运行的ID存储在自定义的ID中.

## 非目标

- 不在 Discord 按钮中显示 cron 即时文本、 提供者配置、 脚本参数、 cookie、 令牌、 账户 ID 或 原始提供者 JSON 。
- 不要让Discord用户通过重试按钮提供任意命令或提示.
- 不更改 cron YAML 格式。
- 不改变排程器级故障警报以外的特定输出行为。

## 现有建筑证据

- `src/cron/scheduler.ts`拥有发送、重试尝试计数、重试延迟和`runningJobs`.
- `src/cron/state.ts`持续`~/.miniclaw/cron/state.json`.
- `src/bot.ts`已处理用于智能路由器确认的 Discord 按钮交互。
- `docs/quality-gates.md`需要调整调度器以同步`docs/architecture.md`.

## 执行计划

1. 以失败元数据扩展 cron 状态: 尝试计数, 下一次重试时间, 失败运行 ID, 提醒消息/通道 IDs.
2. 添加一个调度器级故障通知符,该通知符会构建已消化的Discord摘要并重试按钮组件.
3. 将纯重试睡眠替换为可唤醒重试等待,这样按钮就可以触发下一次尝试而不启动平行运行.
4. 添加 Discord 按钮处理器`miniclaw:cron:retry:<runId>`执行`config.allowedUserId`.
5. 更新提醒发送/编辑/恢复行为的调度器测试和可觉醒的重复。
6. 更新结构和路径文件。

## 核查计划

- 单位测试:`pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`
- 类型检查:`pnpm run typecheck`
- 林特: - 莱特:`pnpm run lint`
- 如果时间允许,则扩大推门:`pnpm run quality:push`

## 风险 倒车

- 风险:一个失败的警报发送可以掩盖原始的cron失败.
- 缓解:发现并记录了通知错误;继续重复试验行为。
- 风险:在任务积极运行时单击重试可能会产生重复执行.
- 缓解:调度器只有在没有当前运行时才会唤醒回试或启动新的单试运行。
- 风险:错误信息可能包括敏感文本。
- 缓解:总结和消毒错误文本,从不在按钮标识中包含即时/提供/标语配置。
- 回滚:删除新的按钮处理器和失败通知器调用;调度器重试行为只恢复到当前状态记录.

## 文档同步

- README:不需要修改用户设置。
- 文件:更新`docs/architecture.md`颅部和`docs/bot-routing.md`按钮路由部分。
- 变身:不在场。

## 执行笔记

- 添加带有Discord重试按钮的调度器级故障提醒 。
- 添加可觉醒重试后退, 因此立即重试不会产生并行运行 。
- 已经添加了`state.json`运行 ID、 尝试、 下次重试 和提醒消息/ 频道 ID 的失败元数据 。
- 在智能路由器按钮前添加 cron 重试按钮路由。
- 核查:
  - `pnpm vitest run src/cron/__tests__/scheduler.test.ts src/cron/__tests__/failure-notifier.test.ts src/cron/__tests__/state.test.ts`
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm run e2e:cron`

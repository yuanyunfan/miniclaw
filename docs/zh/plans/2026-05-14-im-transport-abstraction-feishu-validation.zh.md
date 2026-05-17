---
doc_id: im-transport-abstraction-feishu-validation-plan
lang: zh
translation_of: docs/plans/2026-05-14-im-transport-abstraction-feishu-validation.md
translation_status: current
source_sha256: 9a92f2b4701951731e84186955afb72967f995049b2686e6236fc8fb5d373dd9
---
# IM 传输抽象与飞书出站验证

现况:已完成
日期: 2026-05-14

## 背景

MiniClaw 已经中立了`AgentRuntime`, `ModelClient`,以及`IMTransport`合同文件,但活动消息路径仍然取决于Discord SDK类型在bot 路由, cron 交付,任务视图渲染,恢复外框和医生通知中.

当务之急是使未来的IM整合切实可行,而不改变Claude/Codex任务执行者。 第二个IM验证目标为飞舒,而非Telegram.

## 目标

- 保留当前 Discord 记录为作为默认,并保留现有的cron YAML兼容性。
- 引入具有明确能力和目标参考的IM适配器边界。
- 使用自定义的bot webhook语义法,添加飞书外出传输。
- 让克龙工作通过逻辑选择额外的IM交付`delivery_route`.
- 为当前 Discord 记录通过传输边界处理的路由 outbox。
- 在任何完整的入境网关迁移之前,用重点单位测试来证明抽象。

## 非目标

- 不要替换这个片子里的Discord机器人网关。
- 不要将斜线命令、 Discord 按钮或线程继续移动到平台中立的入境网关。
- 不要求用户重写现有的 cron 文件 。
- 不要让 Feishu 支持交互重试按钮或任务恢复 。

## 现有架构证据

- `src/runtime/im-transport.ts`定义最初的中性传输契约。
- `src/bot.ts`拥有活动 Discord 网关和事件发送。
- `src/discord/task-view-reporter.ts`拥有 Discord 任务进度/ 最终渲染 。
- `src/cron/runner-message.ts`, `src/cron/runner-task.ts`,以及`src/cron/failure-notifier.ts`直接发送到 Discord 频道 。
- `src/monitoring/recovery-outbox.ts`目前通过 Discord flush待交付`Client`.

## 执行计划

1. 添加`src/im/contracts.ts`与传输身份、能力、目标、信息参考、发送/编辑/文件/线索合同有关。
2. 保留`src/runtime/im-transport.ts`作为兼容性再导出。
3. 添加配置支持:
   - `im.default_transport`
   - `im.transports.feishu.enabled`
   - `im.transports.feishu.webhook_url`
   - `im.transports.feishu.secret`
   - `im.routes.<name>.targets[]`
4. 添加出入境适配器:
   - `src/im/adapters/discord/transport.ts`
   - `src/im/adapters/feishu/transport.ts`
5. 添加:`src/im/registry.ts`和`src/im/delivery.ts`用于解析逻辑传送路径和发送文本扇形。
6. 首先调整低风险出入境路径:
   - `type=message`交货
- 完成最后额外交付的任务/技能
- 作为仅限文本的Feishufallback,发出故障警报
- 通过 Discord 传输边界的outboxflush
7. 更新文件和配置实例。

## 验证计划

- 单位测试:
- 配置路径解析
- 卸载机`delivery_route`
- Feishu Webhook有效载荷/签名
- IM送货粉丝
- outboxflush仍然标记了交付的Discord 记录
- 静态检查:
  - `pnpm run typecheck`
  - `pnpm run lint`
- 重点回归:
  - `pnpm vitest run src/im/__tests__ src/cron/__tests__/runner-message.test.ts src/cron/__tests__/loader.test.ts src/monitoring/__tests__/recovery-outbox.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts`

## 风险与回滚

- 风险:飞雪交付失败 任务看起来很成功
- 缓解:任务/技能额外交付记录警告,不改变任务结果;`type=message`仍然把提供作为工作业务行动。
- 风险:路由配置意外禁用Discord输出.
- 缓解:legacy`channel`仍然是首要的Discord目标;`delivery_route`增加额外目标,除非呼叫者稍后明确使用仅限路由的发送.
- 风险:不成熟的入境抽象会扩大切片.
- 缓解:保持Discord网关和命令处理不变。
- 退后:删除`delivery_route`失业和休假`im.transports.feishu.enabled=false`; Discord 发送路径仍然是默认路径.

## 文档同步

- 最新情况`docs/architecture.md`来描述当前只输出的 IM 抽象状态。
- 最新情况`config.example.yaml`与费修交通和路线实例.

## 执行记录

- 2026-05-14:执行中立契约的出站 IM 抽象,Discord 传输适配器,Feishu自定义-bot webhook传输,逻辑`delivery_route`扇形显示 cron 消息/ 任务/ 技能结果, cron 失败额外发送, 以及 Discord 传输边界中flush的回收输出框 。
- 验证:`pnpm run typecheck`; `pnpm vitest run src/im/__tests__ src/cron/__tests__/runner-message.test.ts src/cron/__tests__/loader.test.ts src/monitoring/__tests__/recovery-outbox.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts`(7个文件,60个测试);`pnpm run lint`; `pnpm run quality:docs`; `pnpm test`(167份文件,828项测试);`pnpm run build`.

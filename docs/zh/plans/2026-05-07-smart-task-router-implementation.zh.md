---
doc_id: smart-task-router-implementation-plan
lang: zh
translation_of: docs/plans/2026-05-07-smart-task-router-implementation.md
translation_status: current
source_sha256: 31df635e1b47f17c4ba1911ec32de89e6dc0c22f53ab2ce4038c23b26019dfb5
---
# 智能任务路由器执行

现况:已完成
日期:2026-05-07

## 背景情况

MiniClaw 目前通过表面路径 Discord 消息 :

- `/task`明确创建任务线程。
- `routing.task_channels`将配置频道中的每个普通消息变成任务 。
- `routing.auto_reply_channels`并提及进入轻量级聊天路径。

这是可以预测的,但发送到聊天功能频道的类似任务自然语言的提示进入只读聊天路径. 描述的智能任务路由器`docs/archive/features/05-smart-task-router.en.md`在聊天之前,应该对符合条件的信息进行分类,或者保持聊天,建议任务模式,请求任务确认,或者在信任的频道中自动创建任务.

## 目标

- 保留现有`/task`,任务线索恢复,任务通道,和聊天行为,除非明确启用智能路由.
- 在下面添加结构化的智能路由配置`routing.smart_router`.
- 在下方增加每个通道的清晰cwd覆盖`routing.channel_defaults`.
- 为路由决定添加经编辑的SQLite决定日志。
- 增加确定路线的分类,加上对模棱两可的案件要求的LLM分类管道。
- 添加Discord按钮用于`task_suggest`和`task_confirm`.
- 重新使用相同的任务创建和`executeTask()`流动为`/task`.
- 仅在提示明确引用上下文时, 才包含未信任的最近聊天上下文 。

## 非目标

- 不合并聊天和任务权限。
- 不要在第一个版本中坚持SQLite的确认状态。
- 不支持回答`yes`作为确认。
- 不执行 OpenClaw 风格的持久信道/会话绑定。
- 不在明确配置的自动任务通道外自动运行任务。

## 现有建筑证据

- `src/bot.ts`: 拥有`MessageCreate`和`InteractionCreate`发送。
- `src/commands/handlers.ts`: `/task`创建线程、 写任务行、 发送嵌入状态和调用`executeTask`.
- `src/agent/task.ts`:任务执行,进度更新,最终Markdown输出.
- `src/agent/chat.ts`: 面向阅读的聊天路径和聊天历史持续.
- `src/config.ts`: YAML + 嵌入层配置,包括`routing.auto_reply_channels`和`routing.task_channels`.
- `src/store/db.ts`: SQLite schema and task/chat-history students. 互联网档案馆的存檔,存档日期2013-03-02. 互联网档案馆的存檔,存档日期2014-09-02. 互联网档案馆的存檔,存档日期2014-09-02.

## 执行计划

1. 为智能路由器设置和频道 cwd 覆盖添加配置解析。
2. 添加 SQLite 表格和助手`smart_router_decisions`.
3. 增加纯路由模块:
- 确定血压分类器;
- 行动解决器;
- 上下文参考探测器和不可信上下文构建器;
- 启用时用于模棱两可的可选LLM分类器适配器。
4. 将任务录入创建提取到共享的 Discord 帮助器中`/task`,任务通道,自动升级,确认升级使用一个任务启动路径.
5. 添加10分钟的TTL和Discord按钮自定义标识,只带一个短符号/动作。
6. 整合`MessageCreate`内存命令处理后和聊天前的智能路由.
7. 扩展`InteractionCreate`在命令发送前按下按钮。
8. 更新文件和配置示例,以匹配运出的行为。

## 核查计划

- 类型检查:`pnpm build`.
- 单位测试:
  - `src/routing/__tests__/intent.test.ts`
  - `src/routing/__tests__/context.test.ts`
  - `src/routing/__tests__/confirmations.test.ts`
  - `src/store/__tests__/db.test.ts`
  - `src/__tests__/config.test.ts`
- 更广泛的回归:`pnpm test`.

手动Discord E2E被故意推迟到代码构建和测试通过之后:

- 正常聊天提示仍作为聊天回答;
- 在符合条件的聊天频道中类似任务提示显示按钮;
- 转换到任务按钮创建任务线索。
- 继续聊天按钮使用聊天路径。
- 任务频道仍然绕过智能路由确认

## 风险 倒车

- 风险:假阳性任务路由中断正常聊天.
- 缓解:智能路由器默认为禁用,仅在启用时在符合条件的通道中运行,需要在自动任务通道外进行确认。
- 退后:禁用`routing.smart_router.enabled`并重新启动。
- 风险:错误的 cwd 执行错误的 repo 中的任务 。
- 缓解:`channel_defaults`仅明确;`/task cwd`仍然胜出; 状态嵌入显示最终的 cwd 。
- 退后:去掉频道控制器。
- 风险: 重启时丢失按钮状态 。
- 缓解:确认状态是故意的短寿命内存状态;过期时点击返回电源消息。
- 回转: 重新发送提示。
- 风险:LLM分类器故障区块的路由.
- 缓解:未能关闭确定性行动或聊天/建议并记录失败情况。

## 文档同步

- 最新情况`docs/bot-routing.md`与真正的智能路由路径。
- 最新情况`docs/architecture.md`只有在架构图需要可见的路由/配置/schema注释时。
- 最新情况`config.example.yaml`有智能路由器和频道默认示例。

## 执行笔记

- 审查后开始执行`docs/archive/features/05-smart-task-router.en.md`, `src/bot.ts`, `src/commands/handlers.ts`, `src/config.ts`,以及`src/store/db.ts`.
- 添加结构化的智能路由器配置、明确的通道 cwd 默认, SQLite`smart_router_decisions`,定型路由,LLM分类器适配器,内存确认状态,共享Discord任务接收,以及bot消息/按钮集成.
- 通过重点核查:
  - `pnpm build`
  - `pnpm test src/routing/__tests__/intent.test.ts src/routing/__tests__/context.test.ts src/routing/__tests__/confirmations.test.ts src/__tests__/config.test.ts src/store/__tests__/db.test.ts`
- 完全回归:
  - `pnpm test`- 39份档案,通过了277项测试
  - `pnpm build`

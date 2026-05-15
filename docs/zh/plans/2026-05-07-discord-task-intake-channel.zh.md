---
doc_id: discord-task-intake-channel-plan
lang: zh
translation_of: docs/plans/2026-05-07-discord-task-intake-channel.md
translation_status: current
source_sha256: 5cbd52a26bc1283fbba0d2df06b6f89a22bc0f21fe547164dd2cbec79a021115
---
# Discord 任务摄入通道

现况:已完成
日期:2026-05-07

## 背景情况

用户想要一个专用的 Discord 频道, MiniClaw 可以在不需要的情况下接收任务请求`@MiniClaw`.

当前行为 :

- `MINICLAW_AUTO_REPLY_CHANNELS`只允许非提醒聊天回复 。
- `/task`创建孤立的线程并运行`executeTask()`.
- 在现有任务线条内的信息回复恢复该任务段。

这意味着简单地添加一个频道到`MINICLAW_AUTO_REPLY_CHANNELS`将会将消息引导到聊天, 而不是任务执行 。

## 目标

- 创建一个Discord文本频道,专门用于MiniClaw任务接收。
- 添加无智能任务接收通道的配置。
- 该频道发送的信件应创建任务线索并运行`executeTask()`.
- 保留现有`/task`,线程续作,和聊天自动复制行为。
- 避免将所有自动复制聊天频道升级为任务频道。

## 非目标

- 不要删除`/task`.
- 不要改变克伦处决。
- 不允许其他Discord用户触发任务.
- 不要改变提供者选择、沙盒或模型行为。

## 现有建筑证据

- `src/bot.ts`:消息路由,线程延续,自动重回聊天路径.
- `src/commands/handlers.ts`: `/task`创建公共线程和呼叫`executeTask()`.
- `src/config.ts`: 剖析`MINICLAW_AUTO_REPLY_CHANNELS`.
- `src/discord/attachments.ts`: 为聊天和任务共享附件处理.
- `src/agent/task.ts`: 清除任务附件目录`finally`.

## 执行计划

1. 添加`MINICLAW_TASK_CHANNELS`配置为逗号分隔的 Discord 通道 ID 。
2. In `MessageCreate`,在线程继续后,在自动重读聊天之前,从任务频道发送到新任务的路由信息。
3. 对于每个任务渠道的信息:
- 执行允许的用户和最大货币;
- 使用信件内容或附件作为任务提示;
- 从信息中创建一条公共线索;
- 创建任务DB行;
- 将任务启动嵌入;
- 运行`executeTask()`在线。
4. 最新情况`.env.example`, README, 英语README, 架构文件, 机器人路由文件, 和更改日志 。
5. 创建 Discord 频道并将其ID添加到本地`.env`.
6. 重建和重新启动MiniClaw。
7. 在新通道中触发一个烟雾测试信息,并核查任务创建/产出。

## 核查计划

- 类型检查:`pnpm build`.
- 单位测试:如果提取到任何配置/路由辅助器,则进行定向测试;否则,要依靠类型检查和活烟测试。
- 手动/E2E:
- 在Discord中创建频道;
- 不加提及地发出一条信息;
- 确认MiniClaw创建一条线;
- 确认完成数据库任务状态;
- 确认Discord输出使用正常的任务状态/进度/最终的Markdown结构.

## 风险 倒车

- 风险:一个频道不慎在聊天自动检索和任务频道上市。
- 缓解:在聊天自动复制之前检查任务频道;记录该任务获胜。
- 风险:任务频道的随机信息启动一项昂贵的任务。
- 缓解:专用通道名称和现有`MINICLAW_ALLOWED_USER_ID`大门
- 风险:任务创建前附件处理失败 。
- 缓解:以错误回答,不创建任务行。
- 回滚:删除新频道ID`MINICLAW_TASK_CHANNELS`,重新启动 MiniClaw,并选择删除Discord 频道。

## 文档同步

- README:添加任务频道配置和行为.
- 读英文版一样
- Docs/architecture.md:添加任务通道分支.
- Docs/bot-routing.md:添加路由路径.
- ChangeGELOG.md:录制该功能.

## 执行笔记

- 已经添加了`MINICLAW_TASK_CHANNELS`和路由匹配`MessageCreate`在聊天自动复制路由之前的任务线程创建事件。
- 创建的Discord 频道`#task`在现有的AI类之下。
- 添加任务频道ID到本地`MINICLAW_TASK_CHANNELS`并重新启动 PM2 与`--update-env`.
- 烟雾测试信息`#task`创建任务和任务线索。
- 通过Codex完成烟雾测试`tools=0`持续时间`26.8s`,以及最终的Discord输出,确认任务通道有效.
- 通过核查命令:`pnpm build`* 目标测试附件/材料/任务帮助者,以及`git diff --check`.

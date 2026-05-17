---
doc_id: complexity-hotspot-refactor-plan
lang: zh
translation_of: docs/plans/2026-05-11-complexity-hotspot-refactor.md
translation_status: current
source_sha256: 07905c4766f8953edefae8d322fcdfd099b97c743f39c538774957ebe9507f60
---
# 复杂热点计划

现况:已完成
日期: 2026-05-11

## 背景

`docs/archive/2026-05-11-continuous-improvement-report.md`确定责任累积的几个文件:

- `src/providers/market-intel/collectors/official.ts`
- `src/agent/task.ts`
- `src/ops/doctor-scheduler.ts`
- `src/bot.ts`
- `src/ops/doctor-repair.ts`
- `src/store/db.ts`
- `src/config.ts`
- `src/ops/doctor.ts`

问题不单单是线条数。 风险在于无关的顾虑共享同一文件,因此AI代理未来更改更可能落地错层,打破隐藏合同,或需要广泛的背景审查.

这项计划是一个协调计划。 不在一个会话中执行下面的每一个重构 。 用它来选择一个窄片,添加或保存测试,然后更新执行记录.

## 目标

- 以稳定的责任划分神模块。
- 在提取过程中保持公共行为不变。
- 围绕提取出来的纯逻辑增加重点测试。
- 减少未来的爆炸半径,用于Provider、路线、repair、任务、DB和配置变化。
- 避免粗略的格式化。

## 非目标

- 不要重写整个工程架构。
- 除非特性需要提取,否则不要将它与新特性结合起来。
- 不重命名没有兼容层的大 API 。
- 不移动文件只是为了减少行数。
- 不要将未经测试的行为改变 隐藏在重构物中。

## 现有架构证据

- `src/bot.ts`: Discord 消息处理,智能路由器,聊天,任务通道接收,按钮路由,斜线发送.
- `src/agent/task.ts`:活动任务生命周期,跑者,SDK事件,Discord渲染,最终输出,DB状态.
- `src/ops/doctor-scheduler.ts`:扫描环路,分组,通知,修复触发政策,调度器状态.
- `src/providers/market-intel/collectors/official.ts`:多种市场数据收集和解析关切。
- `src/ops/doctor-repair.ts`:政策,prompt 构建,工作树,agent 执行,验证,允许路径检查,commit/push.
- `src/store/db.ts`: 计划创建、迁移、任务/聊天/路由/事件/活动的repository。
- `src/config.ts`:YAML/env 加载,验证,路径解析,Runtime 配置,E2E守护,许多特性配置.

## 重订原则

- 从纯粹的提取开始,而不是行为改变。
- 在移动复杂分支之前加入特征测试。
- 保存外部模块所依赖的导出名称。
- 使用小型PR/commit片。
- 在提取出纯逻辑后,I/O重码优先依赖性注射。
- 每一片之后都保持文档和测试一致

## 切片 A：`src/bot.ts` 消息和交互调度

### 目标文件

- `src/bot/message-thread-continuation.ts`
- `src/bot/message-task-channel.ts`
- `src/bot/message-chat.ts`
- `src/bot/message-smart-router.ts`
- `src/bot/button-dispatch.ts`
- `src/bot/slash-dispatch.ts`

### 计划

1. 增加一个`src/bot/`保存顶级目录`src/bot.ts`作为公众进入。
2. 先提取纯路线决定helper.
- 输入:消息元数据,频道ID,线程状态,路由配置.
- 输出: 路由动作enum。
3. 将智能路由器消息路径移动到`message-smart-router.ts`.
- 保留现有的DB记录助手或注入他们。
4. 将任务渠道的接收量移到`message-task-channel.ts`.
- 继续使用`src/discord/task-intake.ts`.
5. 将聊天路径移入`message-chat.ts`.
- 保持许可和E2E作者的守护行为不变.
6. 将线程继续移动到`message-thread-continuation.ts`.
- 保留恢复/会话兼容性检查。
7. 将按钮路由移动到`button-dispatch.ts`.
- 继续重试和智能路由按钮 命令明确。
8. 将斜线命令调度移入`slash-dispatch.ts`.
   - `src/commands/handlers.ts`仍执行命令。

### 测试

- 增加路线决定测试,如果尚未涵盖的话。
- 重新运行智能路由器,确认,和E2E假Runtime测试。

## 切片 B：`src/agent/task.ts` 运行时边界

使用`2026-05-11-task-view-boundary.md`作为详细的实施计划。

保持此切片分离, 因为它会影响任务取消, Provider流化, Discord 输出, 以及 DB 持久性 。

## 切片 C：`src/ops/doctor-scheduler.ts` Doctor 调度器

### 目标文件

- `src/ops/doctor-scheduler/scan-loop.ts`
- `src/ops/doctor-scheduler/grouping.ts`
- `src/ops/doctor-scheduler/notifications.ts`
- `src/ops/doctor-scheduler/repair-policy.ts`
- `src/ops/doctor-scheduler/state.ts`

### 计划

1. 提取事件分类为纯函数。
2. 从Discord中提取通知格式发送副作用.
3. 从扫描循环中提取修复调度/速率限制政策。
4. 保持公众`startDoctorScheduler()`或相当的输入稳定。
5. 围绕分组、通知文本和修复附加测试。

### 测试

- `pnpm vitest run src/ops/__tests__/doctor-scheduler*.test.ts`
- 为提取的模块添加新的测试。

## 切片 D：`src/providers/market-intel/collectors/official.ts`

### 目标文件

- `src/providers/market-intel/collectors/calendar.ts`
- `src/providers/market-intel/collectors/news.ts`
- `src/providers/market-intel/collectors/events.ts`
- `src/providers/market-intel/collectors/quotes.ts`
- `src/providers/market-intel/collectors/macro.ts`
- `src/providers/market-intel/collectors/scoring-input.ts`
- `src/providers/market-intel/collectors/parsers/*.ts`

### 计划

1. 利用稳定的静态固定数据,为当前采集器输出添加固定测试。
2. 首先提取特定源解析器。
3. 收集器第二部。
4. 在测试证明平等之前,保持导出 collectorAPI不变。
5. 增加每个来源(如果还没有的话)的编辑/记录检查。

### 测试

- `pnpm vitest run src/providers/market-intel`
- 在移动网络成像码前加入解析器固定测试。

## 切片 E：`src/ops/doctor-repair.ts`

### 目标文件

- `src/ops/doctor-repair/policy.ts`
- `src/ops/doctor-repair/prompt.ts`
- `src/ops/doctor-repair/worktree.ts`
- `src/ops/doctor-repair/verification.ts`
- `src/ops/doctor-repair/path-policy.ts`
- `src/ops/doctor-repair/report.ts`

### 计划

1. 提取修复政策和路径政策作为纯模块。
2. 提取修复快速构建器并添加快照式测试.
3. 提取校验命令操作包。
4. 提取接口背后的工作树/分支操作。
5. 保留`scripts/doctor-repair.ts`CLI行为不变.

### 测试

- 现有`src/ops/__tests__/doctor-repair*.test.ts`如果现在。
- 添加策略、快速和路径许可列表的单位测试。

## 切片 F：`src/store/db.ts`

使用`2026-05-11-db-migrations-state-lifecycle.md`作为详细的实施计划。

不将 DB 迁移提取与不相关的计划添加混合,除非计划添加是试点迁移.

## 切片 G：`src/config.ts`

使用`2026-05-11-config-schema-first.md`作为详细的实施计划。

配置重构符应保留`import { config } from "../config.js"`在第一个片段。

## 执行计划

1. 在编码前选择一个切片。
2. 确定公共导出和目前的测试。
3. 如果行为尚未涵盖,则增加最低定性测试。
4. 提取纯函数或副作用边界。
5. 尽可能保留旧的条目文件。
6. 进行重点测试和静态门。
7. 更新文件和本计划的执行说明。

## 验证计划

每一片的基线 :

- `pnpm run typecheck`
- `pnpm run lint`
- 专注`pnpm vitest run ...`

当切片触及Runtime输出时 :

- `pnpm run build`
- 相关的E2E假/固定命令,例如:`pnpm run e2e:cron`或有重点的假Runtime测试。

当切片触及到文件/来源真实行为时:

- `pnpm run quality:docs`

## 风险与回滚

- 风险:行为变化被隐藏在提取内部.
- 缓解:增加特征测试,并保护公共API。
- 回滚:返回切片commit;如果测试失败,不要部分保留移动的代码。
- 风险:与其他计划发生冲突。
- 缓解:通过专门计划完成任务 Runtime、DB和配置。
- 风险:进口货到货到货
- 缓解措施:在过渡期间保留文件和再导出旧名。
- 风险:大重构无法恢复。
- 缓解:每支部队一个单元。

## 文档同步

- 最新情况`docs/architecture.md`当模块边界发生变化时。
- 最新情况`docs/bot-routing.md`只有在行为或调度命令发生改变时,才能进行机器人路由提取。
- 最新情况`docs/quality-gates.md`如果添加了新的测试/门。
- 将计划文件作为执行记录 而不是永恒的行为真相来源

## 执行记录

对于每个完成的片段,记录:

- 切片名称
- 更改文件
- 行为平等测试
- 任何公共API更改
- 后续清理

### 2026-05-12 - 切片 A 互动调度提取器

- 切片名称:切片A部分,相互作用的发送边界.
- 更改的文件 :
  - `src/bot.ts`: 保留`createBot()`和信件创建流程作为公开条目、授权按钮和斜线交互`src/bot/*`.
  - `src/bot/message-smart-router.ts`: 提取智能路由器决定日志,任务快速上下文构建,以及确认快速/按钮构建.
  - `src/bot/button-dispatch.ts`: 提取 cron 重试 + 智能路由器按钮调度命令和共享按钮错误回复行为.
  - `src/bot/slash-dispatch.ts`: 提取斜线命令名称至`commands/handlers.ts`映射和共享命令错误回复行为.
  - `src/bot/__tests__/button-dispatch.test.ts`: 添加了cron- prefore-smart-router命令的特征测试,未声明的按钮,以及按钮错误回复.
  - `src/bot/__tests__/slash-dispatch.test.ts`:增加了处理器路由的特性测试,未知的命令回复,以及延迟前/后错误回复.
  - `docs/bot-routing.md`, `docs/architecture.md`:记录了新的bot调度模块边界,并更新了斜线/按钮扩展指导.
- 行为平等测试:
  - `pnpm vitest run src/bot/__tests__/button-dispatch.test.ts src/bot/__tests__/slash-dispatch.test.ts src/routing/__tests__/message-route.test.ts`通过了15次测试
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
  - `pnpm run build`通过。
- 公共API更改:无。`createBot()`从`src/bot.ts`;交互命令仍为cron重试按钮,智能路由器按钮,然后是斜线命令.
- 后续清理: 消息创建聊天/任务/线索路径仍然存在`src/bot.ts`; 未来的 Slice A 阶段可以提取`message-task-channel.ts`, `message-chat.ts`,以及`message-thread-continuation.ts`并进行重点测试。

### 2026-05-12 - 切片 A 信息生成调度提取器

- 切片名称:切片 A 完成, MessageCreate 调度边界.
- 更改的文件 :
  - `src/bot.ts`: 保留`createBot()`作为公共Discord客户端条目,保留路由计算/裁员警卫/客户端准备恢复,并授权MessageCreate商业路径`src/bot/*`.
  - `src/bot/message-thread-continuation.ts`: 提取任务线索恢复/会话兼容性守护,后续附件处理,任务行创建,记者事件,以及`executeTask(... resumeSessionId ...)`线线.
  - `src/bot/message-task-channel.ts`: 提取专用任务通道摄入量, bot 引用剥离, 能力检查, 任务上下文捕获, 并共享`createAndRunDiscordTask()`打电话
  - `src/bot/message-chat.ts`:提取聊天路线预检,明确内存短路,智能路由器自动/确认/聊天路由,附件清理,打字/进度回调,聊天错误格式化.
  - `src/bot/__tests__/message-task-channel.test.ts`, `src/bot/__tests__/message-chat.test.ts`, `src/bot/__tests__/message-thread-continuation.test.ts`:为提取的信息处理器增加了重点特征测试.
  - `docs/bot-routing.md`, `docs/architecture.md`, `docs/chat-router-current-logic.md`: 更新 bot 发送边界文档以指向提取的MessageCreate模块.
- 行为平等测试:
  - `pnpm vitest run src/bot/__tests__/message-task-channel.test.ts src/bot/__tests__/message-chat.test.ts src/bot/__tests__/message-thread-continuation.test.ts src/bot/__tests__/button-dispatch.test.ts src/bot/__tests__/slash-dispatch.test.ts src/routing/__tests__/message-route.test.ts`通过了23次测试
  - `pnpm vitest run src/routing/__tests__/intent.test.ts src/routing/__tests__/confirmations.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts`通过了31次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run build`通过。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API更改:无。`createBot()`从`src/bot.ts`;消息路由命令仍然忽略/排练/线程续作/任务频道/聊天,交互命令不变.
- 后续清理:Slice A现已被提取足够,以便将来在路径特定模块内进行修改。 剩下的复杂热点工作应该从这个计划中转到另一个方面,而不是继续扩大。`src/bot.ts`.

### 2026-05-12 - 切片 C Doctor Scheduler 拆分

- 切片名称:切片C完成,医生排程器状态/分组/通知/修复政策边界。
- 更改的文件 :
  - `src/ops/doctor-scheduler.ts`: 保留`createDoctorScheduler()`和`startDoctorScheduler()`作为公共调度器条目,保留扫描-浏览 DB 写入,通知事件写入,修复引用和依赖性注入线条.
  - `src/ops/doctor-scheduler/state.ts`:提取的MiniClaw日志指纹计算加上运行/指印调度器状态.
  - `src/ops/doctor-scheduler/grouping.ts`: 提取纯通知分组,诊断/源助手,问题文本选择,并实现签名生成正常化.
  - `src/ops/doctor-scheduler/notifications.ts`:提取单/组/Digest事件通知文本,修复通知文本,以及Discord摘要通道交付.
  - `src/ops/doctor-scheduler/repair-policy.ts`: 提取的修复资格, UTC日水桶,以及平行/每日的修复费率限制跳过决定.
  - `src/ops/__tests__/doctor-scheduler-boundaries.test.ts`: 增加了分组正常化的直接测试, 通过提取的 formatter 通知文本, 修复策略跳过原因, 以及调度器状态行为 。
  - `docs/architecture.md`, `docs/archive/features/13-auto-doctor.md`:记录了新的自动医生调度模块边界。
- 行为平等测试:
  - `pnpm vitest run src/ops/__tests__/doctor-scheduler*.test.ts`通过了12次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run build`通过。
  - `pnpm run quality:docs`通过。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API更改:无。`createDoctorScheduler()`, `startDoctorScheduler()`, `DoctorNotificationGroup`, `DoctorNotificationItem`,并保留从`src/ops/doctor-scheduler.ts`.
- 后续清理:剩余的复杂性热点工作应移至Slice D/E/F/G;`doctor-scheduler.ts`现在保持扫描管线边界,不应重新获得通知格式或政策帮助。

### 2026-05-12 - Slice D 官方 Parser 提取

- 切片名称:切片D部分,特定源解析器边界.
- 更改的文件 :
  - `src/providers/market-intel/collectors/official.ts`: 保留`collectMarketIntelOfficialEvidence()`财务处/财务司/财务司/财务司/安保处/安保处/安保处/安保处/安保处/HKEX/PBOC/NBS`collectors/parsers/*`.
  - `src/providers/market-intel/collectors/parsers/shared.ts`:提取纯记录/字符串/日期/新鲜度/HTML-link解析助手.
  - `src/providers/market-intel/collectors/parsers/macro.ts`:提取的财政部XML,BLS JSON,以及联邦储备局的RSS解析逻辑加上BLS系列ID.
  - `src/providers/market-intel/collectors/parsers/filings.ts`: 提取SEC ticker/提交解析器, JSONP解析器,以及SSE/SZSE/HKEX公告解析器.
  - `src/providers/market-intel/collectors/parsers/risk.ts`: 提取出衍生出的风险关键词分类.
  - `src/providers/market-intel/__tests__/official-parsers.test.ts`:为宏添加固定测试,SEC,交换公告,日期HTML,以及风险解析行为.
  - `docs/architecture.md`, `docs/archive/features/14-market-intel-provider.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: 记录解析/解析边界,并更新剩余热点状态。
- 行为平等测试:
  - `pnpm vitest run src/providers/market-intel/__tests__/official-parsers.test.ts src/providers/market-intel/__tests__/official-collectors.test.ts`通过了7次测试
  - `pnpm vitest run src/providers/market-intel`通过了27次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过。
  - `pnpm run build`通过。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API更改:无。`MarketIntelOfficialHttpClient`, `buildEmptyMarketIntelEvidenceCollection()`,以及`collectMarketIntelOfficialEvidence()`继续从`src/providers/market-intel/collectors/official.ts`.
- 后续清理:通过拆分继续D部分`official.ts`由源家进行orchestration,然后通过他们的专用计划移动剩余的Slice E/F/G热点.

### 2026-05-12 - Slice D 官方来源 family 提取

- 切片名称:切片D完成,官方来源-家族采集边界.
- 更改的文件 :
  - `src/providers/market-intel/collectors/official.ts`: 降为公共外观`collectMarketIntelOfficialEvidence()`, `MarketIntelOfficialHttpClient`,以及`buildEmptyMarketIntelEvidenceCollection()`,只有市场范围风扇。
  - `src/providers/market-intel/collectors/macro.ts`:提取出财务处/BLS/PBOC/NBS端点管弦和宏源状态/警告行为.
  - `src/providers/market-intel/collectors/news.ts`:提取的联邦储备局RSS端点orchestration.
  - `src/providers/market-intel/collectors/events.ts`:提取SEC EDGAR+SSE/SZSE/HKEX公告端点orchestration.
  - `src/providers/market-intel/collectors/scoring-input.ts`:提取出的证据部分组装,去dupe,收益/文件分割,衍生出的风险证据,以及空藏的收集构造.
  - `src/providers/market-intel/collectors/official-http.ts`, `src/providers/market-intel/collectors/official-shared.ts`: 提取取回的 HTTP 客户端, 共享源/ 结果helper, 失败redactor, 以及节helper 。
  - `src/providers/market-intel/__tests__/official-collectors.test.ts`:为独立的可调用宏/新闻/活动源家采集器增加了直接特征描述覆盖.
  - `docs/architecture.md`, `docs/archive/features/14-market-intel-provider.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`:记录了新的官方证据表面/来源-家庭/评分-输入边界,并更新了目前的热点状态。
- 行为平等测试:
  - `pnpm vitest run src/providers/market-intel/__tests__/official-collectors.test.ts src/providers/market-intel/__tests__/official-parsers.test.ts`通过了8次测试
  - `pnpm vitest run src/providers/market-intel`通过了28次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过。
  - `pnpm run build`通过。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API更改:无。 现有进口`src/providers/market-intel/collectors/official.ts`继续有效。
- 后续清理:Slice D现在已足够完整,新的官方市场-情报来源应在来源-家庭采集器模块中着陆,并配有剖析器固定装置,而不是表面。 剩余的复杂热点工作应移至Slice E/F/G。

### 2026-05-12 - 切片E医生修复纯度边界提取器

- 切片名称:切片E部分,修复政策/路径/prompt/验证边界。
- 更改的文件 :
  - `src/ops/doctor-repair.ts`: 保留`runDoctorRepair()`, CLI 参数,结果格式化,工作树/代理/commit/push,兼容性导出作为公共修复的表面.
  - `src/ops/doctor-repair/policy.ts`: 提取repair合格门和强制/配置处理作为无配置的纯政策模块.
  - `src/ops/doctor-repair/path-policy.ts`: 提取 git 瓷器更改文件解析 + 允许/ block glob 路径验证 。
  - `src/ops/doctor-repair/prompt.ts`: 提取的repair worker prompt 渲染，并注入 allow/block 路径策略.
  - `src/ops/doctor-repair/verification.ts`:提取目标测试选择,标准校验命令列表,以及命令跑步循环.
  - `src/ops/__tests__/doctor-repair-boundaries.test.ts`:为提取的政策、路径、prompt 和验证边界增加重点特征测试。
  - `docs/archive/features/13-auto-doctor.md`, `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`:记录了新的守备维修舱边界,并更新了热点状态.
- 行为平等测试:
  - `pnpm vitest run src/ops/__tests__/doctor-repair.test.ts src/ops/__tests__/doctor-repair-boundaries.test.ts`通过了17次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm run quality:docs`通过。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API改变:现有消费者没有。 现有进口`src/ops/doctor-repair.ts`用于政策、路径验证、目标测试选择、修复执行和格式化的功能仍然有效。
- 后续清理:通过提取工作树/分支操作、Codex修复代理执行、commit/push helper以及报告orchestration shell的格式,继续开展Slice E。

### 2026-05-12 - Slice E医生修复执行边界

- 切片名称:切片E完成,修复工作树/代理/报告边界。
- 更改的文件 :
  - `src/ops/doctor-repair.ts`: 保留`runDoctorRepair()`, CLI args, 兼容性导出, 事件状态过渡, repair_run更新, 以及高层 repair orchestration作为公共外观.
  - `src/ops/doctor-repair/worktree.ts`: 提取默认命令运行器, 修复 id sanitization, 工作树路径/分支生成, 工作树准备, 依赖安装守护, 当前 SHA 搜索, 修复 传输消息, 校验commit, 以及孤立的分支驱动helper 。
  - `src/ops/doctor-repair/agent.ts`:提取Codex修复代理流,超时处理,代理响应捕获,工具日志捕获,代理故障映射.
  - `src/ops/doctor-repair/report.ts`: 提取 CLI/ 报告格式用于干运行, 政策, 更改文件, 校验, commit, 并push 状态输出 。
  - `src/ops/__tests__/doctor-repair-boundaries.test.ts`:增加了对已消毒的工作树目标的重点测试,工作树创建/再使用指令路由,commit/push指令路由,以及报告格式化.
  - `docs/architecture.md`, `docs/archive/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`:记录了已完成的守备维修舱边界,并更新了热点状态.
- 行为平等测试:
  - `pnpm vitest run src/ops/__tests__/doctor-repair.test.ts src/ops/__tests__/doctor-repair-boundaries.test.ts`通过了21次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run build`通过。
  - `pnpm run quality:docs`通过。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API改变:现有消费者没有。`runDoctorRepair()`, `parseDoctorRepairArgs()`, `evaluateRepairPolicy()`, `validateChangedPaths()`, `selectTargetedTestCommands()`, `formatDoctorRepairResult()`,且相关的外观出口类型仍可从`src/ops/doctor-repair.ts`.
- 后续清理:Slice E现在已足够完整,新的修复政策、Git/worktree行为、代理流行为、验证规则和报告文本应在有重点测试的提取模块中着陆。 剩余的复杂热点工作应转移到Slice F/G或下一个明确选定的热点,而不是扩大`src/ops/doctor-repair.ts`.

### 2026-05-12 - 切片 F DB 迁移边界

- 切片名称:切片F部分、图/迁移/审计边界。
- 更改的文件 :
  - `src/store/db.ts`: 保持公共 DB 的外观,连接在其中,任务/聊天/Smart路由器helper,`SCHEMA_VERSION`再导出和兼容性`__testables`; 授权基准计划创建和迁移执行`src/store/schema.ts`.
  - `src/store/schema.ts`: 添加`SCHEMA_VERSION = 10`, `ensureBaseSchema()`, `runMigrations()`,计划版本检查,以及`listSchemaVersionHistory()`.
  - `src/store/migrations/*`: 提取当前 v1-v10 的 schema 迁移到版本的迁移模块外加共享列/历史helper.
  - `src/store/__tests__/migrations.test.ts`:为新的 DB 迁移历史添加了内置的 SQLite 测试, 遗留 v4 到当前升级, idepotent 重播, 以及失败的迁移回滚行为.
  - `src/store/__tests__/db.test.ts`:覆盖了表面层的图案历史表和历史行.
  - `scripts/quality-docs.ts`, `docs/architecture.md`, `docs/quality-gates.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: 将图解版真伪源移动到`src/store/schema.ts`,记录`schema_version_history`,并更新剩余热点状态。
- 行为平等测试:
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts`通过了24次测试
  - `pnpm vitest run src/store`通过了43次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm test`通过,137个文件 / 684个测试。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API变化:现有进口`src/store/db.ts`继续有效,包括`SCHEMA_VERSION`; 新的诊断助手`listSchemaVersionHistory()`从表面导出。 SQLite 计划版本从9到10`schema_version_history`.
- 后续清理:通过拆分继续F节`tasks`, `chat_history`,以及`smart_router_decisions`仓库帮助退出`src/store/db.ts`;保留配置、清理命令和共享诊断脱敏策略仍然是今后的阶段。

### 2026-05-12 - 切片 F DB 仓库边界

- 切片名称:切片F部分,连接和任务/聊天/智能路由器repository边界.
- 更改的文件 :
  - `src/store/db.ts`: 减为 DB init/schema 外观, 兼容性再导出, 以及 Stage 场景helper; 现有导入自`src/store/db.ts`继续有效。
  - `src/store/connection.ts`:添加存储模块使用的共享直播 SQLite 手柄.
  - `src/store/repositories/tasks.ts`:提取任务行类型,任务创建,更新,查询helper,活动/中断/最近上市,以及智能路由器结果回写线条.
  - `src/store/repositories/chat-history.ts`: 提取聊天历史附件/列表助手.
  - `src/store/repositories/smart-router-decisions.ts`:提取智能路由器决定/审查类型和决定记录,用户选择,结果,最近,和审查helper.
  - `src/store/task-events.ts`, `src/store/incidents.ts`, `src/store/market-forecasts.ts`: 切换现有拆分存储模块以依赖`src/store/connection.ts`而不是公共的DB外观。
  - `src/store/__tests__/db.test.ts`: 添加任务状态的直接存储库特征描述范围 - > 智能路由器结果链接和每个频道聊天历史命令.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`:记录了连接/存储边界,并更新了剩余的热点状态。
- 行为平等测试:
  - `pnpm vitest run src/store/__tests__/db.test.ts`通过了22次测试
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts`通过了26次测试
  - `pnpm vitest run src/store`通过了45次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共 API 修改:没有用于初始化的商店使用。`getDb()`,任务助手、聊天助手和智能路由器助手继续被从`src/store/db.ts`.
- 后续清理:保留配置,干运行清理指令,共享诊断修饰政策仍然是未来的Slice F工作;更广泛的配置工作属于Slice G.

### 2026-05-12 - 切片 F DB 国家保留区清理边界

- 切片名称:切片F部分,状态保留清理边界.
- 更改的文件 :
  - `src/store/state-cleanup.ts`: 添加清理目标规划外加干运行保存点模拟和交易支持的执行行为`chat_history`, `task_events`, `smart_router_decisions`、事件/事件、修复和市场预测。
  - `scripts/state-cleanup.ts`, `package.json`: 添加`pnpm run state:cleanup -- [--dry-run | --execute] [--table <scope>] [--older-than-days <n>]`.
  - `src/config.ts`, `src/__tests__/config.test.ts`, `config.example.yaml`: 添加`state.retention.*`默认并覆盖覆盖。
  - `src/store/__tests__/state-cleanup.test.ts`:增加dry-run回滚,单镜清理,市场预测儿童-父母前删除,封闭事件清理安全的重点测试.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-db-migrations-state-lifecycle.md`: 记录了清理边界, 默认值, 以及剩余的脱敏策略漏洞 。
- 行为平等测试:
  - `pnpm vitest run src/store/__tests__/state-cleanup.test.ts`通过了6次测试
  - `pnpm vitest run src/__tests__/config.test.ts`通过了17次测试
  - `pnpm vitest run src/store`通过,7个文件/51个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
- 临时DB烟雾`pnpm run state:cleanup -- --dry-run --table task_events --older-than-days 30`0名候选人通过`/private/tmp/miniclaw-state-cleanup-smoke.db`;临时DB文物经核实后被移除.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API修改:现有DB表面消费者不修改。 新state cleanup助手直接从`src/store/state-cleanup.ts`; CLI 默认为dry-run.
- 后续清理:共享诊断脱敏策略仍然是未来的Slice F工作;更广泛的schema-first config分裂仍然属于Slice G.

### 2026-05-12 - 切片 F 共享诊断校正边界

- 切片名称:切片F完成,共享诊断脱敏策略界限。
- 更改的文件 :
  - `src/privacy/diagnostic-redaction.ts`: 添加证书文本、原始prompt/body/Provider payload字段、电子邮件/电话文本和散列会话/账户标识符的共享诊断编辑helper。
  - `src/store/task-trace-export.ts`: 以共享政策和编辑输出的任务/会话代号取代任务跟踪-局部编辑程序,同时保留允许列表的有效载荷投影和`redacted_payload_keys`.
  - `src/commands/incident-detail.ts`: 路由事件摘要/来源/诊断值,任务痕量片段,修复路径,以及事件有效载荷通过共享诊断编辑渲染.
  - `src/commands/task-log.ts`, `src/discord/task-trace-attachment.ts`: 更新安全副本以提及会话/账户编辑。
  - `src/privacy/__tests__/diagnostic-redaction.test.ts`, `src/store/__tests__/task-trace-export.test.ts`, `src/commands/__tests__/incident-detail.test.ts`:增加重点编辑报道.
  - `docs/architecture.md`, `docs/archive/features/03-discord-task-output.md`, `docs/archive/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-db-migrations-state-lifecycle.md`:记录了共享的诊断校正边界,并标记了完成的DB生命周期子计划.
- 行为平等测试:
  - `pnpm vitest run src/privacy/__tests__/diagnostic-redaction.test.ts src/store/__tests__/task-trace-export.test.ts src/commands/__tests__/incident-detail.test.ts`通过了12次测试
  - `pnpm vitest run src/commands/__tests__/task-log.test.ts src/discord/__tests__/task-view-reporter.test.ts`通过了11次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共 API 更改:没有函数签名更改 。 任务跟踪导出模型/ Markdown 现在将原始会话 ID 编辑为散列标识符 。
——后续清理:切片F现已完成. 剩余的复杂热点工作应移至Slice G 配置图谱的first refactor或另一个明确选定的热点;未来的Provider dry-run/诊断捆绑应再利用`src/privacy/diagnostic-redaction.ts`.

### 2026-05-12 - 切片 G 配置 load/Env/resolve/E2E 边界提取

- 切片名称:切片G部分,假面和纯边界提取.
- 更改的文件 :
  - `src/config.ts`: 降低到兼容性外观再导出`src/config/index.ts`.
  - `src/config/index.ts`保持Runtime 配置组装,`config`, `assertE2eSafeRuntimePath()`,公共类型 re-export,处理env 基础URL副作用,以及当前YAML/env/默认行为.
  - `src/config/load.ts`: 提取 YAML 文件加载, 默认配置路径行为, 明显缺失配置错误, 以及原始对象的系统验证交接 。
  - `src/config/env.ts`:提取env优先,原始配置路径读取,scalar/boolean/数字/列表解析,enum/ inherit解析,无限预算/回合解析.
  - `src/config/schema.ts`: 添加 Zod 后置的原始对象计划加上共享的enum值常数.
  - `src/config/resolve.ts`: 提取`~`路径解析和`routing.channel_defaults.*.cwd`决议。
  - `src/config/e2e-guard.ts`:提取纯E2E临时目录隔离检查.
  - `src/config/types.ts`: 移动公共配置类型别名和`SmtpEmailNotificationConfig`.
  - `src/config/__tests__/config-boundaries.test.ts`:增加了负载/env/resolve/schema/E2E护卫界限的重点测试.
  - `src/quality/docs-drift.ts`, `src/quality/__tests__/docs-drift.test.ts`, `docs/quality-gates.md`: 扩展文档漂移绘图以涵盖未来`src/config/**`变化。
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-config-schema-first.md`:记录了新的边界和剩余的Runtime组装工作。
- 行为平等测试:
  - `pnpm vitest run src/quality/__tests__/docs-drift.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts`通过了36次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
- 公共API更改:无。 现有`import { config } from "../config.js"`调用站点仍然有效,没有更改用户配置字段/env密钥。
- 后续清理:通过分拆继续Slice G`src/config/index.ts`进入域运行时构建器,添加更深域计划,在突变易变测试后冻结最终Runtime 配置对象。

### 2026-05-12 - Slice G 配置 runtime domain builder 提取

- 切片名称:切片 G 完成,配置Runtime/域-构建者边界.
- 更改的文件 :
  - `src/config/index.ts`:减少为公共导出和现有的proxy side-effect import。
  - `src/config/runtime.ts`: 增加Runtime composition,`createRuntimeConfig()`, `config`,提供商基础 URL env 副作用保存,auto-reply warning,最后的 E2E 跨字段验证,以及Runtimedeep-freeze.
  - `src/config/domains/agent.ts`, `routing.ts`, `storage.ts`, `tasks.ts`, `operations.ts`, `attachments.ts`, `providers.ts`, `e2e.ts`, `mcp.ts`:分割域默认,YAML路径,env密钥映射,enum/typed 校验器,以及路径解析出运行时的假面.
  - `src/config/__tests__/config-boundaries.test.ts`:在不导入singleton config外观的情况下,添加直接Runtime成分和deep-freeze测试.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`, `docs/plans/2026-05-11-config-schema-first.md`: 记录已完成的配置运行时边界, 并更新剩余热点状态 。
- 行为平等测试:
  - `pnpm vitest run src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts`通过了28次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API更改:无。 现有进口`src/config.ts` / `../config.js`仍然有效;没有更改用户的YAML/env密钥形状。 Runtime 配置在运行时被冻结,同时保留先前的公用类型Script形状以兼容.
——后续清理:Slice G完成. 剩下的复杂工作应该转到`src/ops/doctor.ts`或单独的明确热点计划 而不是增加配置组装回`src/config/index.ts`.

### 2026-05-12 - 最终热点自动医生诊断边界

- 切片名称:最终复杂热点,只读医生诊断/证据/报告边界。 剩下的就结束了`src/ops/doctor.ts`原始背景列表中的热点; Slice B 任务 Runtime完成于`docs/plans/2026-05-11-task-view-boundary.md`.
- 更改的文件 :
  - `src/ops/doctor.ts`: 降为公共外观`runDoctor()`, `parseDoctorArgs()`, `formatDoctorReport()`, `redactSensitive()`,以及医生类型的出口。
  - `src/ops/doctor/types.ts`: 移动公共医生模式, 证据, 诊断, 报告, 参数, 命令运行, 运行选项类型 。
  - `src/ops/doctor/args.ts`: 提取 CLI 旗帜解析和`~`路径解析。
  - `src/ops/doctor/evidence.ts`: 提取只读 SQLite 任务/任务 事件, cron 状态, 连接状态, PM2, Git, 和日志证据收集.
  - `src/ops/doctor/diagnosis.ts`:提取出的事件类型,严重程度,类别,修复资格,证据摘要,以及下一步行动分类.
  - `src/ops/doctor/report.ts`:提取的 CLI 文本报告格式化.
  - `src/ops/doctor/redaction.ts`:抽取医生-当地编辑和价值正常化helper。
  - `src/ops/__tests__/doctor-boundaries.test.ts`:增加了诊断的直接测试,报告格式化,以及医生的编辑界限.
  - `docs/architecture.md`, `docs/archive/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`:记录了最后的只读博士模块边界,并更新了剩余的热点状态.
- 行为平等测试:
  - `pnpm vitest run src/ops/__tests__/doctor.test.ts src/ops/__tests__/doctor-boundaries.test.ts`通过了十次测试
  - `pnpm vitest run src/ops/__tests__/doctor.test.ts src/ops/__tests__/doctor-boundaries.test.ts src/ops/__tests__/doctor-incidents.test.ts src/ops/__tests__/doctor-scheduler.test.ts src/ops/__tests__/doctor-scheduler-boundaries.test.ts src/ops/__tests__/doctor-repair.test.ts src/ops/__tests__/doctor-repair-boundaries.test.ts src/ops/__tests__/doctor-ship.test.ts src/ops/__tests__/doctor-metrics.test.ts`通过了,9个文件 / 53个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API更改:无。 现有进口`src/ops/doctor.ts` / `../ops/doctor.js`继续有效。
——后续清理:复杂热点计划完成. 未来自动医生的诊断变化应在`src/ops/doctor/evidence.ts`, `diagnosis.ts`, or `report.ts`有重点的测试 而不是扩大外表。

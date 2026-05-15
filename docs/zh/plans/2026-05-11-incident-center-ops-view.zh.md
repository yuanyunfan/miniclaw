---
doc_id: incident-center-ops-view-plan
lang: zh
translation_of: docs/plans/2026-05-11-incident-center-ops-view.md
translation_status: current
source_sha256: 05a3a31c7b3584b8c373e467c7899721f36591653dfb579f5b5c07ec71a0e0e2
---
# 事件中心操作视图

现况:已完成
日期:2026-05-11

## 背景情况

MiniClaw已经有一个有意义的自动医生基金会:

- `/doctor`
- `/incidents`
- `/incident view`
- `/incident resolve`
- `/incident ignore`
- `/incident retry-repair`
- `/incident ship-preview`
- `/incident approve-ship`
- 看守的修理工
- 护航船道
- 安全重启边界

剩下的缺口是操作员的连续性。 从一个事件ID中,用户应该能够追踪原始任务/cron/log证据,任务追踪,修复运行,飞船预览,重启决定,阻断器,回滚指令,以及飞船后监测状态.

## 目标

- 加强`/incident view`进入紧凑的运算符细节视图。
- 按类型、类别、路线、提供者、修复状况和严重程度增加事件搜索/过滤器。
- 增加维修分支审查报告,并附有diff摘要、更改路径、核查命令、风险和回滚命令。
- 将事故与任务跟踪、cron运行细节、修理运行细节、船舶预览和重新启动状态联系起来。
- 将主要的MiniClaw过程只读用于诊断;修理书写停留在孤立的工作树上。

## 非目标

- 不要在这个片段里创建网络仪表板。
- 不要自动更新`main`或未经明确批准重新开始生产。
- 不要在Discord中披露原始证据捆绑、提示、证书、饼干或账户数据。
- 不要让主机器人进程修改源文件 。
- 不要替换`doctor:repair` or `doctor:ship`;改进审查表面。

## 现有建筑证据

- `src/commands/register.ts`: 事件斜线命令已经注册 。
- `src/commands/handlers.ts`: 手柄`/incidents`和`/incident`子命令 。
- `src/commands/incident-detail.ts`:格式事件细节文本.
- `src/store/incidents.ts`:事件,事件,以及修复运行的存储器.
- `src/ops/doctor.ts`:证据收集和诊断。
- `src/ops/doctor-scheduler.ts`:定期诊断,通知,修复尝试.
- `src/ops/doctor-repair.ts`:孤立的工作树修复流量和修复报告.
- `src/ops/doctor-ship.ts`: 警戒舰和可选择的安全重启.
- `docs/zh/archive/features/13-auto-doctor.zh.md`: 当前自动 Doctor 用户界面文件。
- `docs/plans/2026-05-10-miniclaw-auto-doctor-self-repair.md`:原自修环路计划.

## 目标用户经验

### `/incidents`

支持可选过滤器 :

- `status`
- `type`
- `severity`
- `category`
- `provider`
- `route`
- `repair_status`
- `limit`

默认仅是公开事件。

产出应分类和紧凑:

- 头条数
- 最重/类型群体
- 有短ID、严重程度/状况、类型、主题、更新年龄、修复状态的事件行
- 命令提示

### `/incident view id:<prefix>`

当数据存在时添加段落 :

- 核心事件事实
- 源主题
- 诊断摘要
- 如果主题为任务, 链接任务跟踪命令
- 如果主题为 cron 且 cron 运行历史存在, 链接 cron 运行命令
- 最近发生的事件
- 修复运行摘要
- 船舶预览状态
- 重新启动状态
- 挡路牌
- 回滚命令或返回指令
- 下一个推荐操作员动作

### 修复检讨报告

添加可重复使用的用于修复的物件:

- 事件编号和标题
- 修复分支和投入
- 基础SHA
- 更改文件
- 内容摘要
- 核查命令和退出状态
- 阻断路径结果
- 风险和撤回命令
- 船舶/启动命令

通过:

- `pnpm run doctor:ship -- --incident <id>`模拟输出
- `/incident ship-preview`
- 也许`/incident repair-report id:<id>` if `/incident view`变得太长

## 数据模型添加

优先使用现有的`repair_runs.report_json`和`verification_json`先说

如果需要缺失字段, 请在后面添加无效字段 :

- `repair_runs.diff_summary_json`
- `repair_runs.changed_files_json`
- `repair_runs.rollback_command`
- `repair_runs.ship_blockers_json`
- `repair_runs.post_ship_monitoring_json`

在前题证明当前存储的 JSON 无法支持之前, 不要添加计划字段 。

## 执行计划

1. 清点当前事件并修理JSON有效载荷。
- 使用测试和本地干燥输出;不检查文件中的私人实时数据。
2. 添加事件过滤存储助手。
- 扩展`listOpenIncidents`或添加`listIncidents(filters)`.
——保持id-prefix分辨率不变.
- 添加过滤和排序测试。
3. 扩展`/incidents`.
- 在其中添加可选过滤格`src/commands/register.ts`.
- 实施过滤解析`src/commands/handlers.ts`.
- 将输出保持在Discord限制范围内。
4. 改进`formatIncidentDetail`.
- 添加链接的命令提示 :
     - `/task-log id:<task-prefix>`可用时;
- 未来`/cron-run id:<run-id>`(a) 当历史存在时;
     - `pnpm run doctor:ship -- --incident <id>`用于本地预览。
- 从最新的修复中添加修复状态和阻塞器。
5. 增加修理审查。
- 候选人文件 :`src/commands/repair-review.ts` or `src/ops/doctor-repair-report.ts`.
- 用它从`doctor:ship`如果可能的话, 模拟和Discord 飞船预览。
6. 增加船后监测提示。
- 在成功启动/启动后,事故事件应记录主要更新和重新开始尝试。
- 视图应显示这些事件和下一个检查命令,除非已经配置,否则不能自动运行监测。
7. 一旦实施再使用任务追踪出口商。
- 如果痕量导出者尚未降落, 只添加命令提示, 并在执行说明中保留此项目 。
8. 添加测试。
- 事件过滤测试。
- 事故细节格式化测试。
- 为物质测试修复审查。

## 核查计划

- 重点:
  - `pnpm vitest run src/store/__tests__/incidents.test.ts`
  - `pnpm vitest run src/commands/__tests__/incident-detail.test.ts`
- 如果实施修理审查试验,则增加修理审查试验。
- 静态:
  - `pnpm run typecheck`
  - `pnpm run lint`
- 满:
  - `pnpm test`
- 可选的地方烟雾:
  - `pnpm run doctor -- --json`
  - `pnpm run doctor:ship -- --incident <test-incident> --json`当安全测试事件存在时。

## 风险 倒车

- 风险:事件视图超过Discord消息限制.
- 缓解:保持细节紧凑;仅在编辑和大小处理准备就绪时才使用附加的Markdown。
- 风险:过滤器产生误导性空输出。
缓解:包括主动过滤摘要和实例。
- 风险:修复报告泄露敏感文件的diff内容。
- 缓解:默认显示已改变的路径和摘要;避免在Discord中出现原始的diff。
- 风险:操作员命令意味着自动批准。
- 缓解:副本应说明批准界限;船舶/重新启动命令仍明确无误。

## 文档同步

- 最新情况`docs/zh/archive/features/13-auto-doctor.zh.md`.
- 最新情况`docs/architecture.md`如果事件数据模型或命令表面发生变化。
- 最新情况`docs/bot-routing.md`如果斜线命令行为发生了实质性变化。
- 运行`pnpm run quality:docs`.

## 执行笔记

在此记录新的过滤器、 事件行为、 命令输出示例以及执行时的验证证据 。

### 2026-05-13 - 拉尔夫事件列表过滤器

- 执行了第一个可审查阶段:`/incidents`现在支持可选`status`, `type`, `severity`, `category`, `provider`, `route`, `repair_status`,以及`limit`在保存默认开放状态设置行为时过滤 。
- 已经添加了`listIncidents(filters, limit)`和`countIncidents(filters)` in `src/store/incidents.ts`;类别/提供者/路线从现有的JSON有效载荷中读取,以及`repair_status`匹配最新数据`repair_runs.status`。没有添加计划字段。
- 添加压缩事件清单格式`src/commands/incidents.ts`: 活动过滤摘要, 重度/ 类型组, 有短 ID, 重度/ 状态, 类型, 最新修复状态, 更新年龄, 主题, 源路由/ 提供者在出现时, 以及操作员提示 。
- 连接斜线命令选项`src/commands/register.ts`和`handleIncidents` in `src/commands/handlers.ts`.
- 更新文件`docs/archive/features/13-auto-doctor.md`, `docs/bot-routing.md`,以及`docs/architecture.md`用于新建过滤器表面和存储查询行为。
- 通过重点核查:
  - `pnpm vitest run src/store/__tests__/incidents.test.ts src/commands/__tests__/incidents.test.ts src/commands/__tests__/incident-detail.test.ts`- 通过了13次测试。
  - `pnpm run typecheck`- 通过了
  - `pnpm run lint`- 通过了
  - `pnpm run quality:docs`- 建筑文件同步后通过
-拉尔夫医生简介通过:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor`- 通过;包括医生计时器/修理/船舶测试、事故细节测试、排字检查、涂料和漂移症。
- 其余计划项目:更丰富`/incident view`链接、 修补检讨事项、 后任务监测提示, 以及超出列表过滤阶段的未来 cron/ 任务追踪深层链接。

### 2026-05-13 - 拉尔夫运营商细节视图

- 执行了下一个可审查阶段:`/incident view`现在构建一个紧凑的操作者详细视图,其中包含核心事实,诊断,源元数据,任务追踪,链接的cron运行,最新的修复审查域,船/重起步状态,回滚提示,下一步行动,操作者命令,以及最近的事件.
- 已经添加了`listCronRunsForIncident(incidentId, limit)` in `src/store/cron-runs.ts`并有线`handleIncident(view)`来通过链接的cron 运行历史为cron事件。 没有添加计划字段;链接使用已有`cron_runs.incident_id`.
- 从现有设备中扩大最新修理渲染`repair_runs.report_json`和`verification_json`:更改的文件,阻塞器,承诺/推错误,以及校验命令状态仅在录制时显示,将Discord输出保留在1900字符守护下.
- 从最近的事件中添加了船舶/重新启动的连续性:船舶预览请求、主要更新、现场重新启动完成/延迟/失败、船舶前对运回的提示,以及根据当前状况和最新修理状况提出的下一个建议操作者行动。
- 更新文件`docs/archive/features/13-auto-doctor.md`, `docs/bot-routing.md`,以及`docs/architecture.md`对于更丰富的操作者视图和 crun-run 链接行为。
- 通过重点核查:
  - `pnpm vitest run src/commands/__tests__/incident-detail.test.ts src/commands/__tests__/incidents.test.ts src/store/__tests__/cron-runs.test.ts`- 通过了16次测试。
  - `pnpm run typecheck`- 通过了
  - `pnpm run lint`- 通过了
  - `pnpm run quality:docs`- 通过了
-拉尔夫医生简介通过:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor`- 通过;包括医生计时器/修理/船舶测试、事故细节测试、排字检查、涂料和漂移症。
- 其余计划项目:单独的可重复使用的维修审查`doctor:ship`干跑/飞船审查,以及未来追踪出口商的深层链接,超出已经显示的命令提示`/incident view`.

### 2026-05-13 - 拉尔夫共享修复审查报告.

- 执行了下一个可审查阶段:`doctor:ship`干跑/执行格式化现在使用可重复使用的修复审查程序,用于从现有设备中建材`repair_runs.report_json`和`verification_json`;没有添加计划字段。
- 已经添加了`formatRepairReviewReport` in `src/ops/doctor-repair/report.ts`并有线`formatDoctorShipResult`对它,所以本地`pnpm run doctor:ship -- --incident <id>`调色板`/incident ship-preview`共享同一报告机构。
- 审查报告现在包括事件身份、船舶状态、修理分支和任务/基地SHA、改变路径、记录时的摘要、推定退出状态的核查命令、路径政策阻断器、风险、回滚指示以及当地/Discord船舶命令。
- 在打印存储的报告字段之前,格式使用共享的诊断编辑政策,并将Discord路径保留在已改变的路径/摘要上,而不是原始的diffs上。
- 更新文件`docs/archive/features/13-auto-doctor.md`和`docs/bot-routing.md`用于共享干燥/船舶审查表面。
- 通过重点核查:
  - `pnpm vitest run src/ops/__tests__/doctor-ship.test.ts`- 通过8次测试。
  - `pnpm run typecheck`- 通过了
  - `pnpm run lint`- 通过了
  - `pnpm run quality:docs`- 通过了
-拉尔夫医生简介通过:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor`- 通过;包括医生计时器/修理/船舶测试、事故细节测试、排字检查、涂料和漂移症。
- 剩余计划项目:未来追踪出口商的深层联系,超出已显示的命令提示`/incident view`.

### 2026-05-13 - 拉尔夫事件任务追踪连续性

- 执行了最后可审查阶段:`/incident view`现在解决了事件主题中的任务跟踪上下文,链接到`cron_runs.task_id`元数据`task_id`,然后显示安全任务追踪出口商摘要和最新的压缩编辑事件行。
- 已经添加了`formatTaskTraceCompactEvents` in `src/store/task-trace-export.ts`因此事件细节可以重用现有的微量投影/红外线,而不是制造原始任务事件有效载荷。
- 把Discord细节紧凑起来:`Task Trace`现在显示已解析的来源、出口商的可用性、完整`/task-log`命令,并且事件证据在出现时会跟踪切片;完整Markdown导出时会留下`/task-log` / `pnpm run task:trace`.
- 有线`handleIncident(view)`(c) 建立和传递直接任务事件和连带任务发生事件的跟踪背景。 未添加计划字段 。
- 更新文件`docs/archive/features/13-auto-doctor.md`, `docs/bot-routing.md`,以及`docs/architecture.md`用于共享的追踪出口者简要行为。
- 通过重点核查:
  - `pnpm vitest run src/commands/__tests__/incident-detail.test.ts src/commands/__tests__/incidents.test.ts src/store/__tests__/task-trace-export.test.ts`- 通过了16次测试。
  - `pnpm run typecheck`- 通过了
  - `pnpm run lint`- 通过了
  - `pnpm run quality:docs`- 通过了
-拉尔夫医生简介通过:
  - `pnpm run ralph:verify -- --task incident-center-ops-view --profile doctor`- 通过;包括医生计时器/修理/船舶测试、事故细节测试、排字检查、涂料和漂移症。
- 所有执行计划项目现已完成并核实;计划状况`done`.

---
doc_id: db-migrations-state-lifecycle-plan
lang: zh
translation_of: docs/plans/2026-05-11-db-migrations-state-lifecycle.md
translation_status: current
source_sha256: 9fc2febca67d697530e039459d81cb5ee4f9ea1d52c9389e77bf6188ed59bf36
---
# DB 迁移与状态生命周期治理

现况:已完成
日期: 2026-05-11

## 背景

`src/store/db.ts`目前拥有schema创建,schema版本升级,任务助手,聊天历史助手,Smart Router助手,以及多个运行时状态表. 随着MiniClaw的积累`task_events`,事件,repair run,市场预测,智能路由器评价领域,以及未来cron运行历史,一个单一的DB模块变得难以审查.

状态生命周期也需要明确的治理。 MiniClaw储存私人业务数据:提示、trace 摘要、Provider payload 摘要、account-adjacent 数据、电子邮件数据以及事件证据。 长期使用不应永远积累敏感数据。

## 目标

- 引入以下版本的迁移模块:`src/store/migrations/`.
- 增加计划迁移审计/历史。
- 从 DB 初始化中拆分表特定repository的帮助。
- 添加保留策略配置和清理命令。
- 确定导出和诊断包的脱敏策略。
- 使现有的用户DB升级路径安全。

## 非目标

- 不要放下或重写用户已有的 DB 。
- 不迁移到不同的数据库引擎。
- 不执行将所有repository分成一个commit。
- 不删除已有的`src/store/db.ts`在调用点迁移前输出。
- 在未明确配置和干运行命令的情况下,不要默默删除数据。

## 现有架构证据

- `src/store/db.ts`: 导出 `SCHEMA_VERSION`,打开 SQLite,创建表,应用迁移,并提供许多helper 方法.
- `src/store/task-events.ts`: 已经从 DB 中分出任务事件附加/ 列表/ 计数 。
- `src/store/incidents.ts`:已经因事件、事件和修复而分道扬镳。
- `src/store/market-forecasts.ts`: 单独的市场预测repository.
- `src/store/__tests__/db.test.ts`: 检查表/栏的存在。
- `docs/architecture.md`:记录schema版本和ER图.
- `scripts/quality-docs.ts`:检查docs schema版本等于代码schema版本.

## 目标存储布局

```text
src/store/
  db.ts                         # open DB, init, compatibility exports
  connection.ts                 # getDb/open/close/test reset if useful
  schema.ts                     # SCHEMA_VERSION and migration runner
  migrations/
    001-initial.ts
    002-chat-history.ts
    ...
    009-router-feedback.ts
  repositories/
    tasks.ts
    chat-history.ts
    smart-router-decisions.ts
    task-events.ts              # may keep current path and re-export
    incidents.ts                # may keep current path and re-export
    market-forecasts.ts         # may keep current path and re-export
```

利用facade 导出避免单一大规模迁移入口.

## Schema 审计建议

添加一个表 :

```sql
CREATE TABLE IF NOT EXISTS schema_version_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_version INTEGER,
  to_version INTEGER NOT NULL,
  migration_name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

规则:

- 在成功执行之后,每次迁移记录一行。
- 不得重复已应用迁移的审计行。
- 迁移失败不应推进`PRAGMA user_version`或等效的元数据。

## 保留政策建议

配置候选人:

```yaml
state:
  retention:
    chat_history_days: 90
    task_events_days: 90
    smart_router_decisions_days: 180
    incidents_days: 365
    repair_runs_days: 365
    market_forecasts_days: 730
    dry_run_default: true
```

清理命令候选人 :

- `pnpm state:cleanup -- --dry-run`
- `pnpm state:cleanup -- --execute`
- `pnpm state:cleanup -- --table task_events --older-than-days 30`

初步实施应默认为dry-run。

## 重新行动政策

增加诊断出口中央政策:

- 快速预览设置长度上限，并可做 hash。
- 原始提示被默认排除。
- Provider payload不包括在内,除非存在Provider专用许可清单。
- 电子邮件/账户/broker 字段必须由Provider专用redactor 脱敏。
- 类似token的字符串,cookie,authorization header,和session ID总是被脱敏.
- 诊断包包括一份省略/脱敏的字段清单。

这项政策应当通过Task Trace export、事故中心、Provider dry-run和state cleanup报告加以重复使用。

## 执行计划

1. 在移动逻辑之前增加 migration runner 测试。
- 测试从空 DB 应用迁移。
- 在旧版本升级到当前版本时测试一个DB.
- 测试第二次 init 的幂等性
2. 提取 `SCHEMA_VERSION` 和 migration runner。
- 保留 `src/store/db.ts` 作为公共 facade。
- 在不改变SQL的情况下,将当前内置迁移块移入迁移函数。
3. 添加`schema_version_history`.
- 采用迁移记录。
- 添加repository/helper,检查诊断历史。
4. 逐步拆分 repositories。
- 第一个候选者:智能路由器决定,因为评估工作将增加字段。
- 如果任务存储器太大,请分开。
- 通过 `db.ts` re-export 避免大范围调用点变更
5. 增加保留配置。
- 如果配置方案的第一个重构符没有落地, 请在当前的配置中保守添加字段 。
- 只有在项目模式需要时,才包括env覆盖。
6. 增加清理命令。
- 新的脚本`scripts/state-cleanup.ts`.
- package script候选人`"state:cleanup": "tsx scripts/state-cleanup.ts"`.
- Dry-run输出列表表,计数,最古老/最新的时间戳,并删除SQL摘要.
7. 增加脱敏策略助手。
- 候选人文件 :`src/privacy/redaction.ts` or `src/store/redaction.ts`.
- 如果Provider框架也将使用中立位置。
8. 更新文件和质量检查。
- 最新情况`docs/architecture.md`schema版本和迁移布局.
- 最新情况`scripts/quality-docs.ts`如果chema版本提取路径改变。

## 验证计划

- 重点:
  - `pnpm vitest run src/store/__tests__/db.test.ts`
- 添加内容`src/store/__tests__/migrations.test.ts`
- 添加内容`src/store/__tests__/state-cleanup.test.ts`如果清理逻辑是纯/可测试的。
- 静态:
  - `pnpm run typecheck`
  - `pnpm run lint`
- 倒退:
  - `pnpm test`
  - `pnpm run build`
- 手动安全:
- 使用临时SQLite DB来进行迁移烟雾.
- 运行`pnpm state:cleanup -- --dry-run`只; 除非明确要求, 在执行期间不要执行在真正的 DB 上删除 。

## 风险与回滚

- 风险:迁移错误会腐蚀用户 DB 。
- 减缓:测试临时DB,在实际迁移之前保持先行移位,文件备份命令。
- 回滚:恢复 DB 备份并恢复迁移commit。
- 风险:表面/再导出漂流中断进口。
- 缓解:保留`db.ts`在调用点迁移之前,导出稳定。
- 风险:清理删除有用状态。
- 缓解:模拟违约,明确`--execute`,保守保留默认值。
- 风险:在文件拆分后进行系统版本文件检查。
- 缓解:最新情况`quality-docs.ts`在同一片块中`SCHEMA_VERSION`移动。

## 文档同步

- 最新情况`docs/architecture.md`ER图,计划版本,迁移生命周期,以及状态保留.
- 最新情况`docs/quality-gates.md` if `quality:docs`开始检查迁移文件 。
- 如果共享脱敏策略,更新Provider/事件/跟踪文件。
- 运行`pnpm run quality:docs`.

## 执行记录

记录迁移版本,repository分割,保存默认,执行时在此进行校验命令.

### 2026-05-12 Slice 1：Schema 迁移 Runner 与审计边界

- 范围:第一个DB生命周期阶段。 提取了基础创建和当前 v1-v10 迁移`src/store/db.ts`未移动任务/聊天/ Smart 路由器仓库helper 。
- 迁移版本:
  - `SCHEMA_VERSION = 10` in `src/store/schema.ts`.
-v1-v9 保留现有的升级行为
- 10号加了`schema_version_history`加上一个独特的`to_version`同位素审计行索引。
- 更改的文件 :
  - `src/store/db.ts`: 仍然是公共外观和再导出`SCHEMA_VERSION`; `initDb()`现在打开 SQLite, 启用 WAL, 调用`ensureBaseSchema()`,并运行版本的迁移。
  - `src/store/schema.ts`:拥有schema版本,基础schema创建,migration runner,历史列表,以及仅测试的迁移应用程序helper.
  - `src/store/migrations/*`:每个计划版本一个模块加上共享的helper/类型.
  - `src/store/__tests__/migrations.test.ts`: 覆盖新的 DB 迁移历史,旧 v4 升级, idempotent 重运行, 和失败的迁移回滚.
  - `src/store/__tests__/db.test.ts`: 覆盖表面层历史表的存在和当前历史行.
  - `scripts/quality-docs.ts`, `docs/architecture.md`, `docs/quality-gates.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: 将版本的真伪源移到`src/store/schema.ts`并记录了审计表。
- 验证:
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts`通过了24次测试
  - `pnpm vitest run src/store`通过了43次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm test`通过,137个文件 / 684个测试。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过。
- 公共API的改变:现有消费者可以继续从`src/store/db.ts`; `listSchemaVersionHistory()`是一个新的诊断外观导出。
- 后续清理:拆分`tasks`, `chat_history`,以及Smart路由器决策helper进入repository模块;保留配置/清理和诊断编辑仍然是未来的阶段。

### 2026-05-12 切片2:存储仓库边界

- 范围:第二个DB生命周期阶段。 已提取任务、 聊天历史和智能路由器决定助手`src/store/db.ts`在保存时输入存储器模块`src/store/db.ts`作为兼容性外观。
- 仓库拆分:
  - `src/store/connection.ts`拥有活的 SQLite 手柄.
  - `src/store/repositories/tasks.ts`拥有任务行,创建,更新,浏览,活动/中断/最近上市,以及智能路由器结果在终端状态变化时回写.
  - `src/store/repositories/chat-history.ts`拥有聊天历史附件/列表行为。
  - `src/store/repositories/smart-router-decisions.ts`拥有决策记录、确认选择、任务结果、最近的决定以及审查列名助手。
- 现有的拆分存储模块`task-events.ts`, `incidents.ts`,以及`market-forecasts.ts`现在取决于`connection.ts`而不是直接进口公众面孔。
- 更改的文件 :
  - `src/store/db.ts`· 仍然是公共外观和再导出的存储器; 舞台现场helper仍然在现场.
  - `src/store/__tests__/db.test.ts`: 为任务结果链接和聊天历史顺序添加直接repository特性测试.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: 记录了repository边界并更新了当前热点状态.
- 验证:
  - `pnpm vitest run src/store/__tests__/db.test.ts`通过了22次测试
  - `pnpm vitest run src/store/__tests__/migrations.test.ts src/store/__tests__/db.test.ts`通过了26次测试
  - `pnpm vitest run src/store`通过了45次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过。
- 公共API变化:现有消费者可以继续导入任务、聊天、智能路由器、计划以及`getDb()`helper来自`src/store/db.ts`.
——后续清理:保留配置,dry-run清理指令,共享诊断脱敏策略仍然是未来阶段.

### 2026-05-12 第3段:国家保留清理边界

- 范围:第三个DB生命周期阶段。 添加可配置保留和一个干运行的第一清理命令,而不修改计划版本,也不在验证时删除任何活用户数据.
- 预留:
  - `chat_history_days = 90`
  - `task_events_days = 90`
  - `smart_router_decisions_days = 180`
  - `incidents_days = 365`
  - `repair_runs_days = 365`
  - `market_forecasts_days = 730`
  - `dry_run_default = true`
- 更改的文件 :
  - `src/store/state-cleanup.ts`:增加state cleanup规划,干运行保存点模拟,交易支持执行模式,分组市场预测儿童清理,以及闭关事件父母安全检查.
  - `scripts/state-cleanup.ts`, `package.json`: 添加`pnpm run state:cleanup -- [--dry-run | --execute] [--table <scope>] [--older-than-days <n>]`.
  - `src/config.ts`, `src/__tests__/config.test.ts`, `config.example.yaml`: 添加`state.retention.*`YAML/env 配置, 覆盖覆盖内涵 。
  - `src/store/__tests__/state-cleanup.test.ts`:覆盖dry-run回滚行为,单镜清理,市场预测儿童在父母前删除,以及封闭事件安全.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: 记录了保留的默认值,清理命令,以及剩余的脱敏策略漏洞.
- 验证:
  - `pnpm vitest run src/store/__tests__/state-cleanup.test.ts`通过了6次测试
  - `pnpm vitest run src/__tests__/config.test.ts`通过了17次测试
  - `pnpm vitest run src/store`通过,7个文件/51个测试。
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
- 临时DB烟雾`pnpm run state:cleanup -- --dry-run --table task_events --older-than-days 30`0名候选人通过`/private/tmp/miniclaw-state-cleanup-smoke.db`;临时DB文物经核实后被移除.
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API修改:现有DB表面消费者不修改。 新的清理helper居住`src/store/state-cleanup.ts`;清理命令默认为dry-run,除非配置或CLI选择执行模式.
- 后续清理:共享诊断脱敏策略仍然是未来的Slice F工作。

### 2026-05-12 切片4:共享诊断脱敏边界

- 范围:DB生命周期/国家治理最后阶段。 增加了可重复使用的诊断校正政策,并将其连接到任务跟踪导出加Auto Doctor事件细节渲染.
- 调整政策:
  - `src/privacy/diagnostic-redaction.ts`拥有共享文本/对象脱敏能力,用于authorization header、cookie、token、prompt/body 字段、原始Provider payload字段、电子邮件/电话文本和会话/账户标识符。
- 会话/账户标识符改为确定相关性的短散列,而不披露原始值。
- Task Trace export仍为允许列表;不允许的有效载荷键继续被计算为`redacted_payload_keys`.
- 更改的文件 :
  - `src/privacy/diagnostic-redaction.ts`: 添加共享诊断编辑助手和政策文本.
  - `src/store/task-trace-export.ts`: 将本地编辑 regex 替换为共享诊断编辑,并在导出型号/马克下重排任务/会话代号.
  - `src/commands/incident-detail.ts`:路由摘要,源/诊断字段,痕量片段,修复路径,以及事件事件有效载荷文本通过共享诊断校正政策.
  - `src/commands/task-log.ts`, `src/discord/task-trace-attachment.ts`: 更新用户界面安全副本,包括会话/账户编辑。
  - `src/privacy/__tests__/diagnostic-redaction.test.ts`, `src/store/__tests__/task-trace-export.test.ts`, `src/commands/__tests__/incident-detail.test.ts`: 覆盖证书文本、 递归对象编辑、 散列会话/账户标识符、 跟踪导出编辑和事件细节编辑。
  - `docs/architecture.md`, `docs/archive/features/03-discord-task-output.md`, `docs/archive/features/13-auto-doctor.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`:记录了共享诊断编辑边界,并更新了热点状态.
- 验证:
  - `pnpm vitest run src/privacy/__tests__/diagnostic-redaction.test.ts src/store/__tests__/task-trace-export.test.ts src/commands/__tests__/incident-detail.test.ts`通过了12次测试
  - `pnpm vitest run src/commands/__tests__/task-log.test.ts src/discord/__tests__/task-view-reporter.test.ts`通过了11次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共 API 更改: 现有任务跟踪函数仍然导出; 输出的跟踪模型现在包含编辑的会话标识符而不是原始session ID.
- 后续清理:DB迁移/状态生命周期计划已经完成。 未来Provider的dry-run或诊断捆绑工作应再利用`src/privacy/diagnostic-redaction.ts`而不是引入提供商-本地通用秘诀。

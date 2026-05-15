---
doc_id: quality-gates-and-discord-e2e-plan
lang: zh
translation_of: docs/plans/2026-05-08-quality-gates-and-discord-e2e.md
translation_status: current
source_sha256: fbda6279d6163e44b74fb3b70e9a46f6a37324decbd38620a62ecb1a31810a87
---
# 质量门和Discord E2E 执行

状态: 进展中
日期:2026-05-08

## 背景情况

`docs/quality-gates.md`定义 MiniClaw 的质量系统为`G0/G1/G2 + L1/L2/L3/L4 + D1`.
当前 repo 已经具有 TypeScript 严格模式, Vitest, 覆盖, 以及只运行的预承诺钩`tsc --noEmit`.
眼前的缺口是,这些检查没有接通一个连贯的地方和CI门。

MiniClaw 也处理 Discord, cron, 本地`~/.miniclaw`配置,秘密,经纪人提供商,以及LLM提供商,所以在添加真正的Discord E2E之前,第一次执行必须优先进行快速,决定性的检查.

## 目标

- 执行`P0-00`通过`P0-04`先说
- 添加稳定的 npm 脚本,用于承诺和推动质量门。
- 为常见的秘密和文物错误添加G0级/树木安全脚本。
- 加强`pre-commit`添加`pre-push`.
- 在22号节点上添加一个基本的 GitHub 动作工作流程。
- 保持真实的Discord E2E作为明确的后切片.

## 非目标

- 切片中不要引入ESLint;属于`P1-01`.
- 切片中不要引入 gi或依赖扫描;这些扫描属于`P1-02`和`P1-03`.
- 切片中不执行完整的Discord E2E带;属于`P0-07`.
- 不要叫真正的Claude/Codex, 真正的Discord, 或真正的曲棍球 在承诺/推时默认。

## 现有建筑证据

- `package.json`: 有过`build`, `test`, `test:cov`,但没有`typecheck`, `quality:commit`, `quality:push`, or `e2e:discord`.
- `scripts/git-hooks/pre-commit`: 目前只运行`pnpm exec tsc --noEmit`.
- `src/__tests__/prompt-snapshot.test.ts`: 现有的L1快速快照覆盖.
- `.github/`: 不在此切片之前出现 。
- `docs/quality-gates.md`:定义P0/P1/P2执行令.

## 执行计划

1. 添加`scripts/quality-g0.ts`.
- 检查节点主版本对照`package.json`发动机。
- 为被封锁的私人路径和高度自信的秘密模式扫描已上演或跟踪的文件。
- 守护软件包依赖性改变从而依赖性编辑阶段`pnpm-lock.yaml`.
2. 最新情况`package.json`.
- 添加内容`typecheck`.
- 添加内容`quality:g0`, `quality:g0:staged`, `quality:commit`, `quality:push`.
- 添加内容`e2e:discord`作为后期P0Discord带的占位符条目.
3. 更新钩子。
   - `pre-commit`运行`quality:commit`.
- 添加内容`pre-push`运行`quality:push`,并仅在`MINICLAW_RUN_DISCORD_E2E=1`.
4. 添加:`.github/workflows/quality.yml`.
-22号节点
- 冷冻装置
- G0树检查,类型检查,测试,建设。

## 核查计划

- `pnpm run quality:g0`
- `pnpm run quality:g0:staged`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `pnpm run quality:commit`

`pnpm run quality:push`包括覆盖,而且可能需要更长的时间,所以应该在第一次通过绿色之后运行.

## 风险 倒车

- 风险:G0秘密模式产生假阳性.
- 缓解:从高自信模式开始,只封锁私人道路。
- 回滚:删除或缩小匹配模式`scripts/quality-g0.ts`.
- 风险:承诺前会变得太慢。
- 缓解:仅包括G0+类型检查+L1测试,匹配`docs/quality-gates.md`.
- 继续`quality:commit`但暂时把它从钩子上除去
- 风险:CI设置与本地pnpm不同.
- 缓解:通过针刺`packageManager`.
- 回滚:更新工作流程包管理器设置。

## 文档同步

- `docs/quality-gates.md`:仍然是全面设计的真相来源.
- 这个计划记录了P0的执行证据。
- 未来切片应在移动到P0-05+时附加执行说明或创建后续计划文件。

## 执行笔记

- 从P0 -00开始,直到P0 -04。
- 已执行`scripts/quality-g0.ts`与舞台/树木模式,阻断私人路径,高信任度秘密检查,节点引擎验证,依赖锁中转守护.
- 添加的软件包脚本:`typecheck`, `quality:g0`, `quality:g0:staged`, `quality:commit`, `quality:push`,并保留`e2e:discord`.
- 更新`scripts/git-hooks/pre-commit`并添加`scripts/git-hooks/pre-push`; 两者都安装到`.git/hooks`与`bash scripts/install-hooks.sh`.
- 已经添加了`.github/workflows/quality.yml`对于节点22,pnpm冷冻安装,G0,类型检查,测试,和构建。
- 通过核查:
  - `pnpm run quality:g0`
  - `pnpm run quality:g0:staged`
  - `pnpm run typecheck`
  - `pnpm test`
  - `pnpm run build`
  - `pnpm run quality:commit`
  - `pnpm run quality:push`
  - `pnpm install --frozen-lockfile --offline`
- 报道报告`quality:push`:全部68个测试文件通过,354个测试通过,总声明覆盖率58.2%. 此切片中未添加阈值 。
- 第一张G0通行证产生了预期的假阳性`.env.example`占位符和`vitest.setup.ts`测试令牌倒置; 匹配这样占位符的收紧任务`process.env`倒置不会失败树扫描 。
- G0树模式现在在本地扫描跟踪和未跟踪的无标记文件,所以新创建的脚本和工作流程在上演前会被检查.
- 继续`P0-05`E2E安全配置.
- 添加了 E2E 运行时配置 :
  - `MINICLAW_E2E_MODE` / `e2e.mode`.
  - `MINICLAW_E2E_SENDER_USER_IDS` / `e2e.sender_user_ids`.
  - `MINICLAW_DISABLE_SCHEDULER` / `e2e.disable_scheduler`.
  - `MINICLAW_MEMORY_PATH` / `storage.memory_path`.
- E2E 模式现在失败, 除非配置、 DB 路径、 内存路径、 默认 cwd 和 频道默认 cwd 在系统临时目录下全部解析。
- E2E模式现在拒绝明确`/task cwd`运行时临时目录以外的路径。
- discord 信件作者过滤现在只允许在启用 E2E 模式时配置的 E2E 发送器 bot ID ;正常的生产 bot 消息仍然被忽略.
- 调度器启动在`MINICLAW_DISABLE_SCHEDULER=true`,阻止 E2E 读取或执行本地 cron 工作。
- 通过当地P0-05核查:
  - `pnpm exec vitest run src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts src/memory/__tests__/memory-md.test.ts src/memory/__tests__/inject.test.ts`
  - `pnpm run typecheck`
- 继续完成其余的质量门任务:
  - `P0-06`: 添加决定性的E2E假聊天/任务代理.
  - `P0-07`: 将占位符 Discord E2E 命令替换为真正的牵引.
  - `P0-08`: 添加聊天,任务,完成嵌入,以及线程后续案件.
  - `P1-01` to `P1-03`:添加ESLint,秘密扫描,依赖扫描.
  - `P1-04`: 将消息路由选择提取到一个测试过的纯函数中.
  - `P1-05` to `P1-07`:增加了E2E文物,手动Discord E2E工作流程,以及cron E2E固定.
  - `P2-01` to `P2-06`: 添加覆盖鼠标、输入风险测试、真剂E2E开关、附件/智能路由器E2E病例和故障分类。
- 新的质量切入点:
  - `pnpm run lint`
  - `pnpm run quality:secrets`
  - `pnpm run quality:deps`
  - `pnpm run quality:coverage`
  - `pnpm run e2e:cron`
  - `pnpm run e2e:discord`

---
doc_id: layered-config-yaml-plan
lang: zh
translation_of: docs/plans/2026-05-07-layered-config-yaml.md
translation_status: current
source_sha256: 9fac6b7b00609d9c7136de44169daf93d7c435245f51445581ae8fea1b38d6e5
---
# 分层的 YAML 配置

现况:已完成
日期:2026-05-07

## 背景情况

MiniClaw 目前从平面读取大多数运行时间设置`.env`变量在`src/config.ts`这对秘密有用,但它使增长`MINICLAW_*`设置很难扫描,因为Discord路由,代理默认, Codex 沙盒, Claude 设置, MCP, 存储, 和附件等父子关系只用长变量名称编码.

首选方向是保持`.env`对于机密和处理拖曳值,然后将结构化的MiniClaw设置移动到用户级的YAML文件中。

## 目标

- 添加内容`~/.miniclaw/config.yaml`辅助`MINICLAW_CONFIG`作为可选的覆盖路径。
- 使用优先级:内置默认值 < YAML 配置 < env 覆盖。
- 维护现有向后兼容性`MINICLAW_*`{\fn华文楷体\fs16\1cHE0E0E0}名字
- 在跟踪文件之外保守秘密,在正常命令输出之外保密。
- 通过主配置对象集中MCP配置路径和允许列表.
- 显示安全配置文件元数据`/agent-config`.
- 更新文件和实例,使建议的设置具有视觉层次。

## 非目标

- 不移动一个通道中每个高级的只覆盖扩展点,例如:即时Dirs、内存路径、cron dirs、舞台盖或日志格式化。
- 不将 API 键或 Discord bot 令牌放入 YAML 示例 。
- 不更改 cron 任务配置格式或提供方特定的 YAML 文件 。
- 在配置加载之外不要改变提供者的行为。

## 现有建筑证据

- 相关文件:
  - `src/config.ts`: env- only MiniClaw 运行时配置 。
  - `src/agent/mcp.ts`: 仍读`MINICLAW_MCP_CONFIG`和`MINICLAW_MCP_ALLOWLIST`直接说
  - `src/agent/runtime-config.ts`: 权限`/agent-config`安全运行时间摘要。
  - `.env.example`, `README.md`, `README.en.md`, `docs/architecture.md`:基于文档env的设置.
- 相关命令:
  - `pnpm build`
  - `pnpm test src/__tests__/config.test.ts src/agent/__tests__/mcp.test.ts src/agent/__tests__/codex.test.ts src/agent/__tests__/runtime-config.test.ts`
  - `pnpm test`
- 相关数据/配置:
- 当地`.env`包含机密和平坦的 MiniClaw 设置。
- 用户级配置应位于`~/.miniclaw/`和远离git。

## 执行计划

1. 在`src/config.ts`.
2. 为字符串、enum、继承、布尔、正数、无限数和字符串数组引入输入解析工具。
3. 将 YAML 段落映射到现有的导出配置形状 :
   - `discord`
   - `routing`
   - `agent`
   - `claude`
   - `codex`
   - `mcp`
   - `storage`
   - `attachments`
4. 保留所有遗留的嵌入键作为覆盖。
5. 最新情况`src/agent/mcp.ts`消费`config.mcp`.
6. 增加 YAML 装入和封装优先的焦点单元测试。
7. 更新运行时配置输出,以显示安全配置元数据。
8. 加 进`config.example.yaml`并围绕 YAML 第一配置重写文件。
9. 通过写作移动本地机器配置`~/.miniclaw/config.yaml`从非机密`.env`价值和减少当地`.env`秘密/陷阱值。

## 核查计划

- 类型检查:`pnpm build`.
- 单位测试:
- 配置 YAML 装载和封装优先。
- MCP加载器仍然通过集中配置来尊重 env 覆盖。
- Codex继承行为保持不变。
  - `/agent-config`格式仍然是保密的。
- 综合检查:
- 恢复pm2 与更新的env。
- 检查最近 pm2 启动错误的记录 。

## 风险 倒车

- 风险:现有`.env`带有空字符串的值可能会无意中覆盖YAML。
- 缓解:将空洞值视为未设置;使用`none`当需要一个明确的空数组覆盖时。
- 风险:从`mcp.ts`可以影响测试隔离。
- 缓解:更新MCP测试,在动态导入前设置嵌入。
- 风险:当地`.env`迁移可能放弃未知的设置 。
- 缓解:保存未知的嵌入键,只移动已知的非秘密设置。
- 回滚:删除`MINICLAW_CONFIG`从`.env`并恢复以前的平面`MINICLAW_*`值; 代码保存遗留的内存支持。

## 文档同步

- README:YAML-第一个快速启动并覆盖兼容性.
- 读英文
- 文件:建筑和规划说明。
- ChangeGELOG:记录层配置支持.

## 执行笔记

- 已执行`src/config.ts`作为带有内置默认,YAML配置的层式加载器,以及遗留的内嵌覆盖.
- 集中提供Claude的MCP路径和允许名单`config.mcp`.
- 已经添加了`config.example.yaml`并重写`.env.example` so `.env`首先是秘密/陷阱
- 更新`/agent-config`以安全配置文件元数据汇总。
- 将本地机器配置到`~/.miniclaw/config.yaml`; 当地`.env`现在只包含`MINICLAW_CONFIG`, Discord 令牌, Anthropic 键, 和 Anthropic 基址 。 原文`.env`被备份在下面`~/.miniclaw/backups/`.
- 保留遗产空白`MINICLAW_DEFAULT_BUDGET_USD` / `MINICLAW_DEFAULT_MAX_TURNS`行为为`unlimited`.
- 核查:
  - `pnpm build`通过。
- 通过重点测试:`src/__tests__/config.test.ts`, `src/agent/__tests__/mcp.test.ts`, `src/agent/__tests__/codex.test.ts`, `src/agent/__tests__/runtime-config.test.ts`.
- 满`pnpm test`通过了:36份测试文件,257份测试文件。
- PM2重新启动`--update-env`; 日志显示`provider=codex model=inherit budget=unlimited maxTurns=unlimited maxConcurrent=4`和 cron 调度器开始 16 个活动任务 / 0 负载错误 。

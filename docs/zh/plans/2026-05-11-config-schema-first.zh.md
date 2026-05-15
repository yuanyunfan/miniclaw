---
doc_id: config-schema-first-plan
lang: zh
translation_of: docs/plans/2026-05-11-config-schema-first.md
translation_status: current
source_sha256: 7750ae8d325953489dccb1d2af42841ea40087385572bb895d398f653c62631b
---
# 配置 Schema- First 重构

现况:已完成
日期:2026-05-11

## 背景情况

`src/config.ts`目前处理YAML/env加载,类型强制,验证,路径解析,E2E隔离守护,代理运行时间配置,医生/连接配置,智能路由器配置,附件/音频文本配置等等.

工程已经取决于`zod`,但主要配置路径尚未确定。 新的运行时间、提供者、运输、医生、保留和任务跟踪设置,如果每个字段都附加在一个大配置文件中,将继续提高审查成本。

## 目标

- 将配置分为负载、图案、分辨率和运行时层。
- 保护`import { config } from "../config.js"`移民期间。
- 使新的配置字段需要计划、默认、嵌入密钥映射和测试。
- 从完全配置的导入副作用中隔离E2E护卫测试.
- 让提供者/医生/运行时间配置可被较小的文件审查。

## 非目标

- 不打破已有用户`~/.miniclaw/config.yaml`.
- 不需要第一个切片中的新配置文件格式。
- 不要删除当前有效的内存。
- 不要转移秘密或运行状态。
- 除非合同类型已经存在,否则不得将这种合同与大周期合同合并。

## 现有建筑证据

- `src/config.ts`: 当前全一配置模块.
- `src/__tests__/config.test.ts`: 现有的配置解析/默认/覆盖测试。
- `config.example.yaml`: 用户化的示例配置.
- `src/e2e/__tests__/safety.test.ts`:E2E隔离警卫覆盖.
- `src/agent/runtime-config.ts`:格式运行时配置摘要.
- `docs/architecture.md`:文档配置和用户级文件布局.

## 目标布局

```text
src/config/
  index.ts          # exports config and public types
  load.ts           # file/env/source loading only
  schema.ts         # zod schemas and raw parsed types
  env.ts            # env key mapping and parsing helpers
  resolve.ts        # home path, defaults, inherit, cwd resolution
  runtime.ts        # final readonly runtime config object
  e2e-guard.ts      # E2E isolation validation
  types.ts          # public config types if needed
```

保留`src/config.ts`暂时作为表面 :

```ts
export * from "./config/index.js";
```

只有在进口被迁移和测试后才能移除外观 。

## 图层责任

### `load.ts`

确定配置文件路径 。
- 如果有,请读YAML。
- 返回原始对象加元数据。
- 不要解决路径。
- 除了分析失败之外,不要验证商业规则。

### `schema.ts`

- 定义Zod计划与默认。
- 验证形状和允许的enum值。
- 保持原始配置类型接近计划。
- 不直接读取文件或嵌入。

### `env.ts`

- 地图`MINICLAW_*`将 vars 输入到配置补丁值 。
- 分析布尔、数字、阵列和路径。
- 包括每个嵌入键的测试。

### `resolve.ts`

- 决断`~`,相对路径,默认cwd,频道默认,以及继承代理设置.
-尽可能保持纯洁

### `runtime.ts`

- 编写负载+env + schema + 分辨率。
- 导出最终冻结/只读配置 。
- 运行最后的跨战区验证。

### `e2e-guard.ts`

- 验证E2E临时目录隔离。
- 尽可能不导入整个运行中的配置单体

## 执行计划

1. 盘点当前配置领域。
- 按领域分组:
- 迪斯科尔/核心
- 代理人/克劳德/科德克斯
- 线路/智能路由器
- 储存/记忆
- 弯腰
- 医生/联系
- 附件/音频
     - E2E
- 供应商
2. 添加`src/config/`模块,不改变行为。
- 先动一下纯洁的帮手
- 通过下列途径保持公共出口稳定:`src/config.ts`.
3. 逐步引入Zod计划。
- 从一个域开始,例如`doctor` or `smart_router`.
- 保留测试中存在的默认值。
- 添加证明无效配置失败的测试 。
4. 打开解析器`env.ts`.
- 建立一个嵌入键和目标路径表。
- 添加当前高值封套的测试。
5. 将路径分辨率移到`resolve.ts`.
- 包含`~`扩展,默认 cwd, DB 路径, 内存路径, 修复工作树根, 以及频道默认 。
6. 将E2E警卫移到`e2e-guard.ts`.
- 为允许的临时路径添加测试,并屏蔽真实的用户路径。
7. 冻结运行时配置对象。
- 防止运行时发生意外突变。
- 如果今天测试突变配置, 请重构测试, 以 env/ config 更改重装模块 。
8. 仅在需要时更新进口。
- 保持大多数呼叫网站从`../config.js`.
- 内部配置测试可以导入特定模块。
9. 更新配置文件和实例。

## 核查计划

- 重点:
  - `pnpm vitest run src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts`
- 添加测试`src/config/*.test.ts`如果合用同一地点`src/config/__tests__/`.
- 静态:
  - `pnpm run typecheck`
  - `pnpm run lint`
- 倒退:
  - `pnpm test`
  - `pnpm run build`
- 浓烟:
- 装入不设配置文件的默认配置 。
- 装入`config.example.yaml`如果有帮助者存在或增加了帮助者。

## 风险 倒车

- 风险:由于`src/config.ts`和`src/config/`碰撞。 碰撞。
- 缓解:保留`src/config.ts`表面并使用明确的相对进口。
- 风险:默认变化无声。
- 缓解:在添加新的语义之前,当前的配置测试必须保持不变。
- 风险:env凌驾于优先变化之上。
- 缓解:增加优先性测试:默认 < YAML < env。
- 风险:E2E警卫变得薄弱。
- 缓解:保留现有的安全试验,并增加警卫职能的直接单位试验。

## 文档同步

- 最新情况`docs/architecture.md`配置一节.
- 最新情况`config.example.yaml`只在用户形状发生变化时。
- 最新情况`docs/quality-gates.md`如果配置验证成为质量门的一部分。
- 运行`pnpm run quality:docs`.

## 执行笔记

执行时在此记录移动的模块,兼容行为,env优先,以及校验命令.

### 2026-05-12 - 配置负载/Env/resolve/E2E 边界采掘

- 范围:第一个计划-第一个重构阶段。 将纯配置加载、 嵌入/ 类型强制、 路径解析度、 原始图谱/ enums、 E2E 守护器以及公共配置类型从全部运行时模块中分离出来,同时保留现有的`src/config.ts`导入外观和用户配置形状。
- 更改的文件 :
  - `src/config.ts`: 降低到兼容性外观再导出`src/config/index.ts`.
  - `src/config/index.ts`保持运行时间配置组装,`config`, `assertE2eSafeRuntimePath()`,公共类型再出口,进程env基础URL副作用,以及现有的默认/env优先行为.
  - `src/config/load.ts`: 提取`MINICLAW_CONFIG`路径解析, YAML 装入, 缺少清晰的配置处理, 以及原始对象的切换。
  - `src/config/env.ts`:提取原始的配置阅读器,env优先,scalar强制,enum/inherit解析,布尔/数字/列表解析,以及无限的预算/转换语义.
  - `src/config/schema.ts`: 添加 Zod 备份的原始对象验证加共享的enum值常数.
  - `src/config/resolve.ts`: 提取出家路径和频道默认的cwd分辨率.
  - `src/config/e2e-guard.ts`:提取纯E2E临时迪尔隔离检查,这样就可以在不导入运行时间单子的情况下测试守卫行为.
  - `src/config/types.ts`:移动了公共配置类型别名和通知配置接口.
  - `src/config/__tests__/config-boundaries.test.ts`:增加了YAML加载的边界测试,明确缺失的配置行为,原始的schema拒绝,env优先,空白-env无限语义,路径分辨率,以及E2E守护行为.
  - `src/quality/docs-drift.ts`, `src/quality/__tests__/docs-drift.test.ts`, `docs/quality-gates.md`: 更新的 Docs 漂移绘图这样的未来`src/config/**`更改需要配置文件同步。
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`:记录了新的配置外观/模块边界和剩余运行时组装热点.
- 行为平等测试:
  - `pnpm vitest run src/quality/__tests__/docs-drift.test.ts src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts`通过了36次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
- 公共API更改:无。 现有进口`src/config.ts` / `../config.js`仍然有效,并且没有更改用户的 YAML/env 密钥形状。
- 后续清理:拆分`src/config/index.ts`由域运行时构建器,添加更深域 Zod schemas/default/env 映射测试,并在测试突变模式被移除时冻结最终运行时配置对象.

### 2026-05-12 - 配置运行时域建材提取器

- 范围:完成了第一道布局边界。 将最后运行时间组成拆分为`src/config/index.ts`,添加代理/Codex/Claude,路由/Smart路由器,存储/状态,任务跟踪附件,医生/连接/通知,附件/音频转录,提供者端点,E2E,和MCP,运行时-froze 最终配置对象而不改变公共类型Script配置形状.
- 更改的文件 :
  - `src/config/index.ts`:减少为公共出口和现有的代理副作用进口。
  - `src/config/runtime.ts`: 添加`createRuntimeConfig()`, `config`, `assertE2eSafeRuntimePath()`,深度运行时间冻结,供应商基础 URL env 副作用保存,自动备份警告,以及最后的 E2E 跨场验证.
  - `src/config/domains/*.ts`: 添加保留默认的域构建器, YAML 路径, env 密钥, enum/ typed 校验器, 以及每个配置域附近的路径解析度.
  - `src/config/__tests__/config-boundaries.test.ts`:在不导入单顿配置外观的情况下,添加了直接运行时构成和深冻覆盖.
  - `docs/architecture.md`, `docs/archive/2026-05-11-continuous-improvement-report.md`: 更新配置边界文档和当前热点状态.
- 行为平等测试:
  - `pnpm vitest run src/config/__tests__/config-boundaries.test.ts src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts`通过了28次测试
  - `pnpm run typecheck`通过。
  - `pnpm run lint`通过。
  - `pnpm run quality:docs`通过了Schema v10。
  - `pnpm run build`通过; 生成忽略`dist/`文物经核实后被移除。
  - `pnpm ralph:verify -- --task complexity-hotspot-refactor --profile standard`通过 :`pnpm run typecheck`, `pnpm run lint`, `pnpm run quality:docs`.
- 公共API更改:无。 现有`import { config } from "../config.js"`呼叫站点依然有效;运行时执行运行时冻结,但公用类型Script形状保持兼容,以避免将这一重构拓宽为呼叫站点类型迁移.
——后续清理:配置计划完成. 新建配置字段应在匹配域构建器加焦点配置测试中着陆, 不在`src/config/index.ts`.

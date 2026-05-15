---
doc_id: config-schema-first-plan
lang: zh
translation_of: docs/plans/2026-05-11-config-schema-first.md
translation_status: not_required
---

# Config Schema-First 重构

状态：`draft`
日期：2026-05-11

## 背景

`src/config.ts` 目前同时处理 YAML/env loading、type coercion、validation、path resolution、E2E isolation guard、agent runtime config、doctor/connectivity config、Smart Router config、attachment/audio transcription config 等。

项目已经依赖 `zod`，但主 config 路径还不是 schema-first。如果每个字段都继续追加到一个大型 config 文件里，新的 runtime、provider、transport、doctor、retention 和 task trace settings 会持续提高 review 成本。

## 目标

- 将 config 拆成 load、schema、resolve 和 runtime 层。
- 迁移期间保留 `import { config } from "../config.js"`。
- 让新 config fields 必须具备 schema、defaults、env key mapping 和 tests。
- 将 E2E guard tests 从完整 config import side effects 中隔离出来。
- 让 provider/doctor/runtime config 可以通过更小的文件 review。

## 非目标

- 不破坏现有用户 `~/.miniclaw/config.yaml`。
- 第一阶段不要求新的 config file format。
- 不移除当前有效的 env overrides。
- 不迁移 secrets 或 runtime state。
- 除非 contract types 已经存在，否则不和大范围 runtime contract changes 混在一起。

## 现有架构证据

- `src/config.ts`：当前 all-in-one config module。
- `src/__tests__/config.test.ts`：现有 config parsing/default/override tests。
- `config.example.yaml`：用户可见的 example config。
- `src/e2e/__tests__/safety.test.ts`：E2E isolation guard coverage。
- `src/agent/runtime-config.ts`：格式化 runtime config summary。
- `docs/architecture.md`：记录 config 和 user-level file layout。

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

临时保留 `src/config.ts` 作为 facade：

```ts
export * from "./config/index.js";
```

只有当 imports 已迁移并验证通过后，才移除 facade。

## 各层职责

### `load.ts`

- 判断 config file path。
- 如果存在则读取 YAML。
- 返回 raw object 和 metadata。
- 不解析 paths。
- 除 parse failure 外，不校验业务规则。

### `schema.ts`

- 定义 Zod schemas 和 defaults。
- 校验 shape 和允许的 enum values。
- 让 raw config types 靠近 schemas。
- 不直接读取 files 或 env。

### `env.ts`

- 将 `MINICLAW_*` env vars 映射为 config patch values。
- 一致地解析 booleans、numbers、arrays 和 paths。
- 为每个 env key 包含测试。

### `resolve.ts`

- 解析 `~`、relative paths、default cwd、channel defaults，以及 inherited agent settings。
- 尽可能保持 pure。

### `runtime.ts`

- 组合 load + env + schema + resolve。
- 导出最终 frozen/readonly config。
- 执行最终 cross-field validation。

### `e2e-guard.ts`

- 校验 E2E temp-dir isolation。
- 尽可能在不 import 整个 running config singleton 的情况下测试。

## 实施计划

1. 盘点当前 config fields。
   - 按 domain 分组：
     - Discord/core
     - agent/Claude/Codex
     - routing/Smart Router
     - storage/memory
     - cron
     - doctor/connectivity
     - attachments/audio
     - E2E
     - providers
2. 增加 `src/config/` modules，不改变行为。
   - 先移动 pure helpers。
   - 通过 `src/config.ts` 保持 public exports 稳定。
3. 逐步引入 Zod schemas。
   - 从一个 domain 开始，例如 `doctor` 或 `smart_router`。
   - 保留现有 tests 中的 defaults。
   - 增加测试，证明 invalid config 会给出有用错误。
4. 将 env parsing 移到 `env.ts`。
   - 建立 env keys 与 target paths 的表。
   - 为当前高价值 env overrides 增加测试。
5. 将 path resolution 移到 `resolve.ts`。
   - 包含 `~` expansion、default cwd、DB path、memory path、repair worktree root 和 channel defaults。
6. 将 E2E guard 移到 `e2e-guard.ts`。
   - 为允许的 temp paths 和被阻止的真实用户 paths 增加测试。
7. Freeze runtime config object。
   - 防止 runtime 期间意外 mutation。
   - 如果当前测试会 mutate config，则改成在 env/config 变化后 reload modules。
8. 只在必要时更新 imports。
   - 大多数 call sites 继续从 `../config.js` import。
   - 内部 config tests 可以 import specific modules。
9. 更新 config docs 和 examples。

## 验证计划

- Focused：
  - `pnpm vitest run src/__tests__/config.test.ts src/e2e/__tests__/safety.test.ts`
  - 如果在 `src/config/__tests__/` 下 colocate，则增加 `src/config/*.test.ts`。
- Static：
  - `pnpm run typecheck`
  - `pnpm run lint`
- Regression：
  - `pnpm test`
  - `pnpm run build`
- Config smoke：
  - 在没有 config file 的 temp env 中加载 default config。
  - 如果存在 helper，则加载 `config.example.yaml`；否则增加一个。

## 风险与回滚

- 风险：`src/config.ts` 和 `src/config/` 冲突导致 import path 破坏。
  - 缓解：保留 `src/config.ts` facade，并使用显式 relative imports。
- 风险：defaults 静默变化。
  - 缓解：在添加新语义前，当前 config tests 必须原样通过。
- 风险：env override precedence 改变。
  - 缓解：为 precedence 增加测试：defaults < YAML < env。
- 风险：E2E guard 变弱。
  - 缓解：保留现有 safety tests，并为 guard function 增加 direct unit tests。

## 文档同步

- 更新 `docs/architecture.md` config section。
- 只有 user-facing shape 改变时，才更新 `config.example.yaml`。
- 如果 config validation 成为 quality gate 的一部分，更新 `docs/quality-gates.md`。
- 运行 `pnpm run quality:docs`。

## 执行记录

实现时在这里记录 moved modules、compatibility behavior、env precedence 和 verification commands。


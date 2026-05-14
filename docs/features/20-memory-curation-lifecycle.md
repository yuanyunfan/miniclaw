# Memory Curation Lifecycle

> 结论：MiniClaw memory 自动抽取不再直接写入 `MEMORY.md`。自动抽取结果先进入候选校验，再做合并决策，最后才写入带 lifecycle metadata 的 Markdown memory；执行 task/chat 时只注入 active memory 的 `name/content`，metadata 只给 maintenance 使用。

## 背景

旧逻辑的问题是抽取模型输出只要有 `type/name/content` 就直接 `addMemory()`。这会把 `[]`、JSON blob、工具输出、`memory_json` 这类脏数据写入 `~/.miniclaw/memories/MEMORY.md`，并且去重只看 `(type, name)`，无法处理同义更新、过期记忆或后续归档。

## 写入链路

自动抽取入口仍在 `src/memory/extract.ts`，但写入流程变为：

1. LLM 按 `prompts/memory-extractor.md` 输出候选数组。
2. `src/memory/curation.ts` 校验候选类型、名称、内容长度、JSON/blob、secret-like assignment 和 blocked name。
3. 通过 canonical key、normalized content/name 和相似度做 `create/update/noop/reject` 决策。
4. 只有 `create/update` 才调用 `upsertMemory()` 写入 Markdown。

显式入口仍保留：

- chat 中 `记住:` 走 `source=explicit_chat`。
- `/remember` 走 `source=slash_remember`。

## Metadata

`src/store/memory-md.ts` 支持以下 metadata comment 字段：

- `status`: `active` 或 `archived`
- `ttl`: `stable`、`project`、`volatile`、`reference`
- `source`
- `confidence`
- `canonical_key`
- `created_at`
- `updated_at`
- `archived_at`
- `archive_reason`

这些字段只用于 maintenance、去重和生命周期管理。`src/memory/inject.ts` 构造 task/chat memory context 时只读取 active rows，并只输出：

```text
- name: content
```

不会把 `ttl/source/canonical_key/status` 等 metadata 传给 LLM。

## Maintenance

`src/memory/maintenance.ts` 提供四类检查：

- `dirty`: 删除 JSON/blob、blocked name、invalid type、疑似 secret assignment。
- `duplicate`: 按 canonical key 或高相似度合并重复记忆。
- `stale`: 按 ttl 和更新时间归档过期记忆。
- `metadata_missing`: 为旧记忆补 lifecycle metadata。

手动 CLI：

```bash
pnpm run memory:maintenance -- --dry-run
pnpm run memory:maintenance -- --apply
pnpm run memory:lint -- --json
```

dry-run 发现问题时返回非 0，用于本地检查或 CI gate；`--apply` 才会修改真实 `MEMORY.md`。

## 定期执行

`src/memory/maintenance-scheduler.ts` 在 MiniClaw 进程启动后注册后台维护任务，不依赖 Discord cron channel。

配置项：

```yaml
memory_maintenance:
  enabled: true
  interval_ms: 86400000
  apply: true
  run_on_start: false
```

对应环境变量：

- `MINICLAW_MEMORY_MAINTENANCE_ENABLED`
- `MINICLAW_MEMORY_MAINTENANCE_INTERVAL_MS`
- `MINICLAW_MEMORY_MAINTENANCE_APPLY`
- `MINICLAW_MEMORY_MAINTENANCE_RUN_ON_START`

E2E mode 默认关闭该 scheduler，避免测试读写真实 `~/.miniclaw/memories/MEMORY.md`。

## 验证

相关测试覆盖：

- `src/memory/__tests__/curation.test.ts`
- `src/memory/__tests__/maintenance.test.ts`
- `src/memory/__tests__/maintenance-scheduler.test.ts`
- `src/memory/__tests__/memory-md.test.ts`
- `src/memory/__tests__/inject.test.ts`

推荐验证命令：

```bash
pnpm vitest run src/memory/__tests__
pnpm run memory:lint -- --json
pnpm run typecheck
```

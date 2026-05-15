---
doc_id: experiments-index
lang: zh
translation_of: docs/experiments/README.md
translation_status: pending
---

# MiniClaw Experiments

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/experiments/README.md`。完整翻译完成后再把 `translation_status` 改为 `current`。

Experiments 文档用于把实验性控制面和稳定 runtime/provider docs 分开：

- Stage 是 CLI / TUI multi-agent console，用于 persona、turn-taking、scene persistence 和 multi-agent UX 研究。它运行在 Discord bot 之外，不能默认改变 Discord task 路径。
- Ralph 是 plan-based fresh-context Codex controller，用 queue、isolated worktree、verification profile 和 integration-safe push 串行执行计划任务。它不是 Discord-facing 功能。

迁移状态：

- `docs/features/01-stage.md` 已变成兼容 stub，当前事实维护在英文 experiments doc 的 Stage section。
- `docs/features/15-ralph-controller.md` 已变成兼容 stub，当前事实维护在英文 experiments doc 的 Ralph Controller section 和 `docs/ralph/**`。
- 中文完整翻译仍是 pending；在此之前，英文 `docs/experiments/README.md` 是实现事实来源。

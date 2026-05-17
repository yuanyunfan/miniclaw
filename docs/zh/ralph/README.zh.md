---
doc_id: ralph-index
lang: zh
translation_of: docs/ralph/README.md
translation_status: current
source_sha256: 7e55cc7e80d452d3d770407960e5a1da24bc4888b5b5a7a5d18f9a75f7e337e2
---
# MiniClaw Ralph

MiniClaw Ralph 是运行基于计划的 Codex 工作的薄控制器,具有新的上下文.

这是有意在bot Runtime之外。 Discord bot不调用此控制器,而Ralph 也不修改live MiniClaw 状态.

## 核心规则

- 每次 Codex 运行处理一个计划任务。
- 每次任务尝试都使用全新的 `codex exec --ephemeral` 上下文。
- 每项任务都有一个隔离的 Git worktree/branch。
- 默认每个任务尝试一个连贯的可审查阶段;避免实施只增加一个helper、类型或测试的微切片,除非计划明确界定该阶段。
- 控制器负责验证、commit，并可选 push。
- `ralph:next`和`ralph:loop`保留`main`当`--merge-main`已使用。
- `--push-main`是集成-安全:Ralph 获取最新 base,重新建立任务分支,在可能时处理冲突,重新验证，执行 lease check,如果远程基地在push 前移动,则重试.
- 原始运行日志是本地的,在下面被忽略`.ralph/`.
- 持久的学习是附加的`docs/ralph/learnings.md`.

## 队列

`docs/ralph/queue.json`把稳定任务 ID 映射到计划文档、验证 profile 和目标分支名。

队列`status`值控制下一个/关闭游标 :

- `pending`
- `running`
- `blocked`
- `done`
- `skipped`

`ralph:next`, `ralph:loop`,以及`ralph:task`选择队列状态的任务`pending`及其计划`Status:`未关闭。 关闭计划状态`blocked`, `closed`, `done`, `shipped`, `skipped`,以及`superseded`.

队列条目可以保留`pending`跨越多个Ralph 迭代。 这是有意的:每一次Codex 运行都奉命落地下一段连贯的可审查阶段,而不是最小的可能的微切片. 代码只有在完整计划真正完成并验证通过时，Codex 才可以把计划 `Status:` 标为 `done`。当 `ralph:run`在任务工作树中看到一个关闭的计划状态, 它在验证和 commit 前同步匹配的队列条目 :

- 计划`done`, `closed`, or `shipped`- > 队列`done`
- 计划`blocked`- > 队列`blocked`
- 计划`skipped` or `superseded`- > 队列`skipped`

## dry-run 模式

```bash
pnpm ralph:run -- --task task-view-boundary
```

dry-run 模式打印已解决的任务,工作树路径,分支,prompt 位置,以及校验配置. 它不创建工作树或运行 Codex.

## 执行

```bash
pnpm ralph:run -- --task task-view-boundary --execute
```

执行模式：

1. 检查控制器的工作区状态;
2. 创建`../miniclaw-ralph/<task-id>`;
3. 在工作树上安装依赖,除非`--skip-install`使用;
4. 运行`codex exec --ephemeral`和把脱敏进度 stream 到终端,同时把原始日志写入`.ralph/`;
5. 计划时同步任务队列状态`Status:`关闭;
6. 运行`pnpm ralph:verify`;
7. 验证通过时,commit 工作树分支。

添加`--push`将分支推向`origin`.

## 提交元数据

队列 `commit_title`值仅为fallback title。 每次 Codex 运行都必须以下列方式结束其最终响应:

```text
Ralph commit title: <type: short specific English title for this phase, max 72 chars>
Ralph commit description:
- <what changed in this phase>
- <why this phase is reviewable on its own>
- <verification evidence you ran>
```

`ralph:run`从`codex-final.md`读取该块，并作为 Git commit subject 和 body 如果该块缺失,拉尔夫会回到队列 `commit_title`并生成一个 body,列出任务、计划、运行标识和更改文件。 提交体总是包括拉尔夫元数据 加上Codex Co-authored-by trailer

## Commit 契约

```bash
pnpm ralph:next -- --execute
```

`ralph:next`是一个一次性 wrapper`ralph:loop`. 它会：

1. 选择第一个开放队列任务;
2. 重新利用已存在的该任务的工作树/branch;
3. 在可能情况下,尽可能把复用的 worktree rebase 到配置好的 base ref;
4. 运行`pnpm ralph:run -- --task <id> --execute --reuse-worktree`.

无`--execute`,只打印选中的任务和命令。

## 任务直到完成

```bash
pnpm ralph:task -- --task task-view-boundary --execute --merge-main --push-main
```

`ralph:task`迭代一个指定的任务,直到任务通过队列状态或计划结束`Status:`它是一个封装`ralph:loop --until-task-done`.

执行模式需要`--merge-main`因为控制器在每一个已核实的任务分支合并后,决定从 base 合入完成结果. 没有合并,没有计划`Status: done`更改将只留在任务分支上,控制器无法安全地观察完成情况。

默认安全限制为25次迭代. 使用`--limit <n>`使这个限制更小或更大。 在任务尚未打开时达到极限会失败命令, 因此无人看管的运行不会默默停止一半 。

## 循环

```bash
pnpm ralph:loop -- --limit 3 --execute --merge-main --push-main
```

循环模式运行到`--limit`拉尔夫重复。 与`--merge-main`仅此一项,每个迭代都通过本地 base 检查进行序列化:

```text
select first open task
-> run fresh Codex in that task worktree
-> verify and commit task branch
-> fast-forward main to the task branch
-> reload the queue and select again
```

与`--merge-main --push-main`, Ralph 使用integration-safe push,而不是简单的本地合并 + push:

```text
select first open task
-> run fresh Codex in that task worktree
-> verify and commit task branch
-> fetch origin/main
-> rebase the task branch onto origin/main
-> if rebase conflicts, run a bounded Codex conflict-resolver pass
-> re-run pnpm ralph:verify in the rebased task worktree
-> check the live remote SHA
-> push task branch to main with a force-with-lease guard
-> if origin/main moved first, fetch/rebase/reverify/retry
-> fast-forward the local main checkout to origin/main after push succeeds
-> reload the queue and select again
```

`--push-main`要求`--merge-main`因此雷波的预推钩仍然运行着`quality:push`大门 使用`--push`仅当您想要发布每个中间体时`ralph/<task>`分支。

如果任务分支存在,但尚未合并到基分支,则循环模式与`--merge-main`停止,然后重新开始运行。 这可以防止在未经审查的分支上不慎堆叠新的 Codex 工作.

## 校验

```bash
pnpm ralph:verify -- --task task-view-boundary
```

校验命令来自任务`verify_commands`; 如果缺席,`verify_profile`已使用。

## 原始日志

原始日志被故意忽略:

```text
.ralph/runs/<task-id>/<timestamp>/
  prompt.md
  codex.jsonl
  codex.stderr.log
  codex-final.md
  result.json
```

不得将原始日志移入tracked docs,除非这些日志已经过审查,以便prompt、账户、token、cookie或Provider的有效载荷泄漏。

终端流被有意总结:命令启动/完成,文件更改事件,代理消息第一行,相位边界,以及周期心跳行被打印. 完整代码 JSONL 和 stderr 保留在`.ralph/runs/...`用于本地调试。

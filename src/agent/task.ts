import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SendableChannels } from "discord.js";
import { config } from "../config.js";
import { updateTask } from "../store/db.js";
import { ProgressReporter } from "../discord/progress.js";
import { taskCompleteEmbed, taskErrorEmbed } from "../discord/formatter.js";
import { chunkMessage } from "../discord/chunks.js";
import { buildMemoryPrompt } from "../memory/inject.js";
import { loadSubagents, listSubagentNames } from "./subagents.js";
import { loadMcpServers } from "./mcp.js";

const PROGRESS_TAIL_LINES = 25;

function toolIcon(name: string): string {
  if (name === "Skill") return "📚";
  if (name === "Bash") return "💻";
  if (name === "Read") return "📖";
  if (name === "Write" || name === "Edit") return "📝";
  if (name === "Glob" || name === "Grep") return "🔎";
  if (name === "WebFetch") return "🌐";
  if (name === "WebSearch") return "🔍";
  if (name === "Agent" || name === "Task") return "🤖";
  if (name.startsWith("mcp__")) return "🔌";
  return "🔧";
}

function toolShortName(name: string): string {
  if (name === "Bash") return "terminal";
  if (name === "Skill") return "skill_view";
  if (name === "Agent" || name === "Task") return "agent";
  if (name.startsWith("mcp__")) return name.slice(5).replace(/__/g, ":");
  return name.toLowerCase();
}

function formatToolDetail(name: string, input: Record<string, unknown>): string {
  let raw = "";
  if (name === "Bash") raw = String(input.command ?? "");
  else if (name === "Read" || name === "Edit" || name === "Write") raw = String(input.file_path ?? "");
  else if (name === "Glob" || name === "Grep") raw = String(input.pattern ?? "");
  else if (name === "Skill") raw = String(input.skill ?? "");
  else if (name === "WebFetch") raw = String(input.url ?? "");
  else if (name === "WebSearch") raw = String(input.query ?? "");
  else if (name === "Agent" || name === "Task") {
    const role = (input.subagent_type as string) ?? "general-purpose";
    const promptStr = String(input.prompt ?? "").slice(0, 60);
    raw = `[${role}] ${promptStr}`;
  } else if (name.startsWith("mcp__")) {
    raw = JSON.stringify(input).slice(0, 80);
  }
  return raw.replace(/\s+/g, " ").trim();
}

export interface TaskResult {
  success: boolean;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  result: string;
  tokensSummary?: string;
}

function fmtTokens(n?: number): string {
  if (n === undefined || n === null) return "-";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatUsage(usage: unknown): string | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const parts: string[] = [];
  if (u.input_tokens !== undefined) parts.push(`in: ${fmtTokens(u.input_tokens)}`);
  if (u.output_tokens !== undefined) parts.push(`out: ${fmtTokens(u.output_tokens)}`);
  if (u.cache_read_input_tokens) parts.push(`cache hit: ${fmtTokens(u.cache_read_input_tokens)}`);
  if (u.cache_creation_input_tokens) parts.push(`cache write: ${fmtTokens(u.cache_creation_input_tokens)}`);
  return parts.length ? parts.join(" · ") : undefined;
}

export const __testables = { fmtTokens, formatUsage };

const activeTasks = new Map<string, AbortController>();

export function getActiveTaskCount(): number {
  return activeTasks.size;
}

export function listActiveTaskIds(): string[] {
  return Array.from(activeTasks.keys());
}

export function cancelTask(taskId: string): boolean {
  const ctrl = activeTasks.get(taskId);
  if (!ctrl) return false;
  ctrl.abort();
  activeTasks.delete(taskId);
  return true;
}

export async function executeTask(params: {
  taskId: string;
  prompt: string;
  cwd: string;
  channel: SendableChannels;
  resumeSessionId?: string;
  /**
   * "embed"（默认）：发 ✅ 任务完成 embed + 执行轨迹（/task 用）
   * "raw"：直接发 LLM 输出文本，无任何元数据装饰（cron / 程序化触发用）
   */
  outputMode?: "embed" | "raw";
}): Promise<TaskResult> {
  const abortController = new AbortController();
  activeTasks.set(params.taskId, abortController);
  const progress = new ProgressReporter(params.taskId);

  const resumeId = params.resumeSessionId;
  if (resumeId !== undefined && (typeof resumeId !== "string" || !resumeId.trim())) {
    throw new Error(`Invalid resumeSessionId: ${resumeId}`);
  }

  try {
    const memoryBlock = buildMemoryPrompt();
    const identityLine = "你是 MiniClaw，一个简洁高效的 AI 助手，通过 Discord 与用户沟通。回复时始终以 MiniClaw 的身份自居，不要说自己是 Claude 或 Claude Code。";

    const subagents = loadSubagents();
    const subagentNames = listSubagentNames();
    const mcpServers = loadMcpServers();
    const supervisorBlock = subagentNames.length
      ? [
          "## 你的角色：Supervisor",
          `你可以通过 Agent 工具分派任务给以下角色化 subagent：${subagentNames.join(" / ")}。`,
          "",
          "**推荐工作流（复杂任务）**：",
          "1. **Researcher** 调研现状、收集 file:line 证据",
          "2. **Planner** 基于调研结果输出步骤化实现计划",
          "3. **Generator** 按计划执行写代码（复杂任务先 Contract 再实施 —— 见下文）",
          "4. **Evaluator** 独立验收（必跑构建/测试），输出 `## Machine-Readable Verdict` YAML 块",
          "",
          "## 编排纪律（必须遵守）",
          "1. **角色严格隔离** —— Researcher / Planner 只读不写；Generator 不验收；Evaluator 不修改代码（这些都已用 SDK 工具白名单物理强制，但你别让 subagent 越界）",
          "2. **每次 Agent 调用都是 fresh context** —— subagent **看不到**你的对话历史。在 prompt 里完整传递它需要的所有信息（前一阶段输出 / 文件路径 / 用户原始需求 / 约束）",
          "3. **文件即真相**（中等以上任务推荐）—— 你可以用 Write 把 Researcher findings 写到 `.miniclaw-task/research.md`，把 Planner spec 写到 `.miniclaw-task/spec.md`，下一阶段调用只在 prompt 里**引用路径**，subagent 自己 Read，避免 context 膨胀",
          "",
          "## Verdict 解析与自动迭代",
          "Evaluator 末尾会输出 `## Machine-Readable Verdict` YAML 块，含 `verdict` (PASS/CONDITIONAL_PASS/FAIL) + `fix_list` + `escalate`。按以下规则路由：",
          "",
          "- `verdict: PASS` → 整合各 subagent 输出，回复用户",
          "- `verdict: CONDITIONAL_PASS` → 主功能可交付，把 fix_list 中的 warning 项一并报告给用户决定是否修复（不强制迭代）",
          "- `verdict: FAIL` → **自动修复循环**：调用 Generator 进入 Fix 模式（prompt 里贴 fix_list YAML 原文），修完再调 Evaluator。**最多 2 轮自动迭代**",
          "- `escalate: true` → **立即停止**，把 escalate_reason + 当前进度报告给用户，不再尝试自动修复",
          "- 2 轮迭代后仍 FAIL → 升级用户，告知尝试历史 + 最后 review 摘要",
          "",
          "## 复杂度判断与 Contract 模式",
          "- 简单任务（单文件 typo / 查询 / 不超过 30 行改动）：可跳过 Researcher/Planner，直接 Generator → Evaluator",
          "- 中等任务（2-3 文件 / 明确改动）：Researcher → Planner → Generator → Evaluator 直走",
          "- 复杂任务（>3 文件 / 新抽象 / 不确定方案）：在调用 Generator 时**首轮要求 Contract 模式**（在 prompt 里写：\"先输出 Contract 不要实施\"）→ 你审 Contract → 第二轮调用 Generator 写实现 → Evaluator",
          "",
          "## 通用约束",
          "- **任何代码改动后必须让 Evaluator 验收** —— 即便简单任务也不例外",
          "- **不要把 subagent 的原文整段抛给用户** —— 你负责整合 + 总结，subagent 详细输出留在执行轨迹里",
          "- **禁止调用 `Skill triad` 或 `Skill triad-resume`** —— 这些是 CLI slash command，与 SDK 流程不兼容；用项目自定义的 4 角色 subagent 完成多阶段任务",
        ].join("\n")
      : "";

    const appendParts = [identityLine, supervisorBlock, memoryBlock].filter(Boolean);

    const q = query({
      prompt: params.prompt,
      options: {
        model: config.model,
        cwd: params.cwd,
        permissionMode: "acceptEdits",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: appendParts.join("\n\n"),
        },
        allowedTools: [
          "Read", "Write", "Edit", "Bash", "Glob",
          "WebSearch", "WebFetch", "Agent",
          "mcp__exa__web_search_exa",
          "mcp__exa__get_code_context_exa",
          "mcp__context7__resolve-library-id",
          "mcp__context7__query-docs",
        ],
        agents: subagents,
        ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
        canUseTool: async (toolName, input) => {
          const skillName = (input as { skill?: string }).skill;
          const BLOCKED_SKILLS = new Set(["triad", "triad-resume"]);
          if (toolName === "Skill" && skillName && BLOCKED_SKILLS.has(skillName)) {
            return {
              behavior: "deny" as const,
              message: `${skillName} 在 miniclaw 中被禁用（它是面向 CLI 交互的 slash command，与 SDK Discord bot 流程不匹配）。请改用 Researcher / Planner / Generator / Evaluator subagent 完成多阶段任务。`,
            };
          }
          return { behavior: "allow" as const, updatedInput: input };
        },
        maxTurns: config.defaultMaxTurns,
        maxBudgetUsd: config.defaultBudgetUsd,
        abortController,
        ...(resumeId ? { resume: resumeId } : {}),
      },
    });

    let sessionId = "";
    let lastResult: TaskResult | null = null;
    const toolCallLog: string[] = [];
    let toolStep = 0;

    for await (const msg of q) {
      if (abortController.signal.aborted) {
        lastResult = {
          success: false,
          sessionId,
          costUsd: 0,
          durationMs: 0,
          turns: 0,
          result: "任务已被用户取消",
        };
        break;
      }

      switch (msg.type) {
        case "system": {
          if ("session_id" in msg && msg.session_id) {
            sessionId = msg.session_id;
            updateTask(params.taskId, { session_id: sessionId });
          }
          break;
        }

        case "assistant": {
          const blocks = msg.message.content;
          const parentId = (msg as { parent_tool_use_id?: string }).parent_tool_use_id;
          const indent = parentId ? "  ↳ " : "";

          for (const block of blocks) {
            if (block.type !== "tool_use") continue;
            toolStep++;
            const input = (block.input ?? {}) as Record<string, unknown>;
            const icon = toolIcon(block.name);
            const short = toolShortName(block.name);
            const detail = formatToolDetail(block.name, input);
            const display = detail.length > 60 ? detail.slice(0, 60) + "..." : detail;
            const line = `${indent}${icon} ${short}${display ? `: "${display}"` : ""}`;

            const lastIdx = toolCallLog.length - 1;
            if (lastIdx >= 0) {
              const last = toolCallLog[lastIdx];
              const baseLast = last.replace(/\s+\(×\d+\)$/, "");
              if (baseLast === line) {
                const m = last.match(/\(×(\d+)\)$/);
                const next = m ? parseInt(m[1], 10) + 1 : 2;
                toolCallLog[lastIdx] = `${line} (×${next})`;
                continue;
              }
            }
            toolCallLog.push(line);
          }

          if (toolCallLog.length) {
            const tail = toolCallLog.slice(-PROGRESS_TAIL_LINES);
            const omitted = toolCallLog.length - tail.length;
            const header = omitted > 0 ? `*…前 ${omitted} 步省略…*\n` : "";
            const body = tail.join("\n");
            await progress.update((header + body).slice(0, 1900), params.channel);
          }
          break;
        }

        case "result": {
          const costUsd = msg.subtype === "success" ? msg.total_cost_usd : 0;
          const durationMs = msg.duration_ms;
          const turns = msg.num_turns;
          const result = msg.subtype === "success"
            ? msg.result
            : ("errors" in msg ? msg.errors.join("\n") : "Unknown error");
          sessionId = msg.session_id || sessionId;
          const tokensSummary = formatUsage((msg as { usage?: unknown }).usage);

          lastResult = {
            success: msg.subtype === "success",
            sessionId,
            costUsd,
            durationMs,
            turns,
            result,
            ...(tokensSummary ? { tokensSummary } : {}),
          };
          break;
        }
      }
    }

    if (!lastResult) {
      lastResult = {
        success: false,
        sessionId,
        costUsd: 0,
        durationMs: 0,
        turns: 0,
        result: "任务被中断或无结果",
      };
    }

    await progress.complete(params.channel);

    updateTask(params.taskId, {
      session_id: lastResult.sessionId,
      status: lastResult.success ? "completed" : "failed",
      result_summary: lastResult.result.slice(0, 10000),
      cost_usd: lastResult.costUsd,
      duration_ms: lastResult.durationMs,
      completed_at: new Date().toISOString(),
    });

    const outputMode = params.outputMode ?? "embed";

    if (outputMode === "raw") {
      // 程序化触发（cron 等）：直接发结果文本，不带任何元数据装饰
      if (lastResult.success) {
        const chunks = chunkMessage(lastResult.result);
        for (const chunk of chunks) {
          await params.channel.send(chunk);
        }
      } else {
        await params.channel.send(`❌ \`${params.taskId.slice(0, 8)}\` 失败: ${lastResult.result.slice(0, 1900)}`);
      }
      return lastResult;
    }

    // outputMode === "embed"（/task 默认）
    const embed = lastResult.success
      ? taskCompleteEmbed({
          taskId: params.taskId,
          result: lastResult.result,
          durationMs: lastResult.durationMs,
          costUsd: lastResult.costUsd,
          turns: lastResult.turns,
          sessionId: lastResult.sessionId,
          ...(lastResult.tokensSummary ? { tokensSummary: lastResult.tokensSummary } : {}),
        })
      : taskErrorEmbed(params.taskId, lastResult.result);

    await params.channel.send({ embeds: [embed] });

    if (toolCallLog.length) {
      const header = `📋 **执行轨迹** (${toolCallLog.length} 步)\n\`\`\`\n`;
      const footer = "\n```";
      const body = toolCallLog.join("\n");
      const maxBodyLen = 1900 - header.length - footer.length;
      if (body.length <= maxBodyLen) {
        await params.channel.send(header + body + footer);
      } else {
        const lines = body.split("\n");
        let buf = "";
        let part = 1;
        for (const line of lines) {
          if (buf.length + line.length + 1 > maxBodyLen) {
            await params.channel.send(`📋 **执行轨迹** (part ${part})\n\`\`\`\n${buf}\n\`\`\``);
            buf = line;
            part++;
          } else {
            buf = buf ? buf + "\n" + line : line;
          }
        }
        if (buf) await params.channel.send(`📋 **执行轨迹** (part ${part})\n\`\`\`\n${buf}\n\`\`\``);
      }
    }

    if (lastResult.result.length > 4096) {
      const chunks = chunkMessage(lastResult.result);
      for (const chunk of chunks) {
        await params.channel.send(chunk);
      }
    }

    return lastResult;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await progress.complete(params.channel, { keepAsError: true });

    updateTask(params.taskId, {
      status: "failed",
      result_summary: errMsg.slice(0, 10000),
      completed_at: new Date().toISOString(),
    });

    await params.channel.send({ embeds: [taskErrorEmbed(params.taskId, errMsg)] });

    return {
      success: false,
      sessionId: "",
      costUsd: 0,
      durationMs: 0,
      turns: 0,
      result: errMsg,
    };
  } finally {
    activeTasks.delete(params.taskId);
  }
}

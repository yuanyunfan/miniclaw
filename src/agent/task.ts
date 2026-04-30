import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SendableChannels } from "discord.js";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { updateTask } from "../store/db.js";
import { ProgressReporter } from "../discord/progress.js";
import { taskCompleteEmbed, taskErrorEmbed } from "../discord/formatter.js";
import { chunkMessage } from "../discord/chunks.js";
import { buildMemoryPrompt } from "../memory/inject.js";
import { loadSubagents, listSubagentNames } from "./subagents.js";
import { loadMcpServers } from "./mcp.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("task");

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

export const IDENTITY_LINE_TASK = "你是 MiniClaw，一个简洁高效的 AI 助手，通过 Discord 与用户沟通。回复时始终以 MiniClaw 的身份自居，不要说自己是 Claude 或 Claude Code。";

export const __testables = { fmtTokens, formatUsage, buildSupervisorBlock, IDENTITY_LINE_TASK };

export function buildSupervisorBlock(subagentNames: string[]): string {
  if (!subagentNames.length) return "";
  return [
    "## 你的角色：Supervisor",
    `你可以通过 Agent 工具分派任务给以下角色化 subagent：${subagentNames.join(" / ")}。`,
    "**这是能力图谱，不是流水线**——根据任务自由组合，不存在「必须按 1→2→3 顺序」的硬规定。",
    "",
    "## 角色能力速查",
    "- **researcher**：本地代码快速 Grep/Read 调研。无 Bash。适合「这个函数在哪定义」「配置怎么读」等轻量本地问题。",
    "- **code-investigator**：可 git clone、可 Bash 遍历的深度调研。适合「调研 GitHub 项目」「理解大型代码库」「跑命令查现状」。**只读心智**——不写、不 commit、不 push。",
    "- **planner**：把模糊需求拆成步骤化实现计划。可写计划但不写代码。适合多文件改动 / 新抽象 / 不确定路径。",
    "- **generator**：实际写代码、改文件、跑构建。**任何代码改动唯一的执行者**。",
    "- **evaluator**：独立审视代码改动 + 跑验收命令。不修代码，只判定。",
    "",
    "## 选择原则（判断，不是流程）",
    "- 简单任务（单 typo / 一行修复）：直接 generator 一步搞定，不必 4 角色都跑",
    "- 调研类任务：根据是否需要执行命令选 researcher（轻量）或 code-investigator（深度，能 git clone）",
    "- 写代码任务：是否要 evaluator 取决于风险——生产代码改动**强烈建议**走 evaluator；纯本地实验或低风险可跳过",
    "- 复杂多文件任务：planner 先出计划再 generator 实施；不确定方案时让 generator 先输出 Contract（在 prompt 里写「先输出 Contract 不要实施」）",
    "",
    "## 编排纪律",
    "1. **角色物理隔离**：工具白名单已 SDK 强制（researcher/planner/evaluator 不能写、generator 没有 Agent）。你按「角色定位」派活，不要硬塞越界请求",
    "2. **fresh context**：subagent **看不到**你的对话历史。把它需要的所有信息（用户原始需求 / 上一角色输出 / 文件路径 / 约束）**显式贴进** prompt",
    "3. **文件即真相**（中等以上任务推荐）：用 Write 把长输出写到 `.miniclaw-task/<phase>.md`，下一角色 prompt 里只引用路径让其自己 Read，避免 context 膨胀",
    "",
    "## Verdict YAML（按需启用，不是默认）",
    "如果你需要程序化判断 evaluator 结论以决定是否触发修复循环，在调用 evaluator 时**显式**写：",
    '> "请在末尾输出 `## Machine-Readable Verdict` YAML 块，含 verdict / fix_list / escalate"',
    "拿到 YAML 后你可按 PASS/CONDITIONAL_PASS/FAIL 路由：FAIL 可以再调一次 generator 进入 Fix 模式（prompt 里贴 fix_list 原文）。**自动迭代建议不超过 2 轮**——超过说明问题超出当前 spec，应升级用户。",
    "如果不需要程序化路由，让 evaluator 用自然语言总结即可。",
    "",
    "## 通用约束",
    "- **不要把 subagent 原文整段抛给用户** —— 你负责整合 + 总结，subagent 详细输出留在执行轨迹里",
    "- **禁止调用 `Skill triad` 或 `Skill triad-resume`** —— 这些是 CLI slash command，与 SDK 流程不兼容",
  ].join("\n");
}

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
  attachmentBlocks?: ContentBlockParam[];
  /**
   * "embed"（默认）：发 ✅ 任务完成 embed + 执行轨迹（/task 用）
   * "raw"：直接发 LLM 输出文本，无任何元数据装饰（cron / 程序化触发用）
   */
  outputMode?: "embed" | "raw";
}): Promise<TaskResult> {
  const abortController = new AbortController();
  activeTasks.set(params.taskId, abortController);
  const progress = new ProgressReporter(params.taskId);
  const startedAt = Date.now();
  const shortId = params.taskId.slice(0, 8);
  log.info(`▶ ${shortId} start cwd=${params.cwd}${params.resumeSessionId ? ` resume=${params.resumeSessionId.slice(0, 8)}` : ""} prompt="${params.prompt.slice(0, 80).replace(/\s+/g, " ")}"`);

  const resumeId = params.resumeSessionId;
  if (resumeId !== undefined && (typeof resumeId !== "string" || !resumeId.trim())) {
    throw new Error(`Invalid resumeSessionId: ${resumeId}`);
  }

  try {
    const memoryBlock = buildMemoryPrompt();
    const identityLine = IDENTITY_LINE_TASK;

    const subagentCalls: string[] = [];
    const SUBAGENT_PER_ROLE_CAP = parseInt(process.env.MINICLAW_SUBAGENT_ROLE_CAP ?? "4", 10);

    const subagents = loadSubagents();
    const subagentNames = listSubagentNames();
    const mcpServers = loadMcpServers();
    const supervisorBlock = buildSupervisorBlock(subagentNames);

    const appendParts = [identityLine, supervisorBlock, memoryBlock].filter(Boolean);

    const hasAttachments = !!(params.attachmentBlocks && params.attachmentBlocks.length);
    const promptParam = hasAttachments
      ? (async function* () {
          yield {
            type: "user" as const,
            parent_tool_use_id: null,
            message: {
              role: "user" as const,
              content: [
                ...params.attachmentBlocks!,
                { type: "text" as const, text: params.prompt },
              ],
            },
          };
        })()
      : params.prompt;

    const q = query({
      prompt: promptParam,
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
              message: `${skillName} 在 miniclaw 中被禁用（它是面向 CLI 交互的 slash command，与 SDK Discord bot 流程不匹配）。请改用项目角色化 subagent 完成多阶段任务。`,
            };
          }
          if (toolName === "Agent" || toolName === "Task") {
            const role = String((input as { subagent_type?: string }).subagent_type ?? "general");
            const used = subagentCalls.filter((r) => r === role).length;
            if (used >= SUBAGENT_PER_ROLE_CAP) {
              return {
                behavior: "deny" as const,
                message: `subagent ${role} 已被调用 ${used} 次（cap=${SUBAGENT_PER_ROLE_CAP}）。继续重复调用很可能是失控循环——请整合现有输出回复用户，或换不同角色，必要时升级用户。`,
              };
            }
            subagentCalls.push(role);
          }
          if (toolName === "Bash") {
            const cmd = String((input as { command?: string }).command ?? "");
            const DESTRUCTIVE = /\b(rm\s+-rf?\s+\/(?!tmp\/|var\/folders\/)|sudo\b|npm\s+publish|pnpm\s+publish|git\s+push\s+--force(?!-with-lease))\b/;
            if (DESTRUCTIVE.test(cmd)) {
              return {
                behavior: "deny" as const,
                message: `Bash 命令被拒绝：检测到高风险破坏性操作 (${cmd.slice(0, 80)})。如确需执行，请由用户手动操作。`,
              };
            }
          }
          return { behavior: "allow" as const, updatedInput: input };
        },
        ...(config.defaultMaxTurns !== undefined ? { maxTurns: config.defaultMaxTurns } : {}),
        ...(config.defaultBudgetUsd !== undefined ? { maxBudgetUsd: config.defaultBudgetUsd } : {}),
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

    const wallMs = Date.now() - startedAt;
    const subagentTrace = subagentCalls.length
      ? ` subagents=[${subagentCalls.join("→")}]`
      : "";
    log.info(
      `${lastResult.success ? "✓" : "✗"} ${shortId} ${lastResult.success ? "done" : "failed"} ` +
      `turns=${lastResult.turns} cost=$${lastResult.costUsd.toFixed(4)} ` +
      `sdk=${lastResult.durationMs}ms wall=${wallMs}ms tools=${toolStep}` +
      subagentTrace +
      (lastResult.tokensSummary ? ` ${lastResult.tokensSummary}` : "")
    );

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
    log.error(`✗ ${shortId} threw after ${Date.now() - startedAt}ms: ${errMsg}`);
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
    // 清理 task 路径下落盘的附件
    try {
      rmSync(join(params.cwd, ".miniclaw-attachments", params.taskId), { recursive: true, force: true });
    } catch {
      // 目录可能从未创建（任务无附件），忽略
    }
  }
}

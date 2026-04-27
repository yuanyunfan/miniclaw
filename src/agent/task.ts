import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SendableChannels } from "discord.js";
import { config } from "../config.js";
import { updateTask } from "../store/db.js";
import { ProgressReporter } from "../discord/progress.js";
import { taskCompleteEmbed, taskErrorEmbed } from "../discord/formatter.js";
import { chunkMessage } from "../discord/chunks.js";
import { buildMemoryPrompt } from "../memory/inject.js";
import { loadSubagents, listSubagentNames } from "./subagents.js";

export interface TaskResult {
  success: boolean;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  result: string;
}

const activeTasks = new Map<string, AbortController>();

export function getActiveTaskCount(): number {
  return activeTasks.size;
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
}): Promise<TaskResult> {
  const abortController = new AbortController();
  activeTasks.set(params.taskId, abortController);
  const progress = new ProgressReporter();

  const resumeId = params.resumeSessionId;
  if (resumeId !== undefined && (typeof resumeId !== "string" || !resumeId.trim())) {
    throw new Error(`Invalid resumeSessionId: ${resumeId}`);
  }

  try {
    const memoryBlock = buildMemoryPrompt();
    const identityLine = "你是 MiniClaw，一个简洁高效的 AI 助手，通过 Discord 与用户沟通。回复时始终以 MiniClaw 的身份自居，不要说自己是 Claude 或 Claude Code。";

    const subagents = loadSubagents();
    const subagentNames = listSubagentNames();
    const supervisorBlock = subagentNames.length
      ? [
          "## 你的角色：Supervisor",
          `你可以通过 Agent 工具分派任务给以下角色化 subagent：${subagentNames.join(" / ")}。`,
          "",
          "**推荐工作流（复杂任务）**：",
          "1. **Researcher** 调研现状、收集 file:line 证据",
          "2. **Planner** 基于调研结果输出步骤化实现计划",
          "3. **Generator** 按计划执行写代码",
          "4. **Evaluator** 独立验收（必跑 `pnpm build`），给出通过/不通过结论",
          "",
          "**规则**：",
          "- 简单任务（单文件 typo、查询）可跳过部分阶段，但**任何代码改动后必须让 Evaluator 验收**",
          "- 调用 subagent 时在 prompt 里**完整传递上下文**（subagent 看不到你的对话历史）",
          "- 如 Evaluator 返回不通过，让 Generator 修复后再次验收，最多迭代 2 轮",
          "- 你自己负责整合各 subagent 输出后回复用户，不要把 subagent 的原文整段抛给用户",
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
        ],
        agents: subagents,
        maxTurns: config.defaultMaxTurns,
        maxBudgetUsd: config.defaultBudgetUsd,
        abortController,
        ...(resumeId ? { resume: resumeId } : {}),
      },
    });

    let sessionId = "";
    let lastResult: TaskResult | null = null;

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
          const subagentPrefix = parentId ? "↳ [subagent] " : "";
          const textParts: string[] = [];
          const toolParts: string[] = [];

          for (const block of blocks) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              if (block.name === "Agent" || block.name === "Task") {
                const input = (block.input ?? {}) as { subagent_type?: string; prompt?: string };
                const role = input.subagent_type ?? "general-purpose";
                const preview = (input.prompt ?? "").slice(0, 80).replace(/\s+/g, " ");
                toolParts.push(`🤖 调用 [${role}]${preview ? `: ${preview}` : ""}`);
              } else {
                toolParts.push(`🔧 ${block.name}`);
              }
            }
          }

          const statusLines: string[] = [];
          if (toolParts.length) statusLines.push(toolParts.join(" | "));
          if (textParts.length) {
            const combined = textParts.join("\n");
            const truncated = combined.length > 500 ? "..." + combined.slice(-500) : combined;
            statusLines.push(subagentPrefix + truncated);
          }

          if (statusLines.length) {
            await progress.update(statusLines.join("\n").slice(0, 2000), params.channel);
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

          lastResult = {
            success: msg.subtype === "success",
            sessionId,
            costUsd,
            durationMs,
            turns,
            result,
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

    const embed = lastResult.success
      ? taskCompleteEmbed({
          taskId: params.taskId,
          result: lastResult.result,
          durationMs: lastResult.durationMs,
          costUsd: lastResult.costUsd,
          turns: lastResult.turns,
          sessionId: lastResult.sessionId,
        })
      : taskErrorEmbed(params.taskId, lastResult.result);

    await params.channel.send({ embeds: [embed] });

    if (lastResult.result.length > 4096) {
      const chunks = chunkMessage(lastResult.result);
      for (const chunk of chunks) {
        await params.channel.send(chunk);
      }
    }

    return lastResult;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await progress.complete(params.channel);

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

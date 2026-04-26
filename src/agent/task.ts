import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SendableChannels } from "discord.js";
import { config } from "../config.js";
import { updateTask } from "../store/db.js";
import { ProgressReporter } from "../discord/progress.js";
import { taskCompleteEmbed, taskErrorEmbed } from "../discord/formatter.js";
import { chunkMessage } from "../discord/chunks.js";

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
    const q = query({
      prompt: params.prompt,
      options: {
        model: config.model,
        cwd: params.cwd,
        permissionMode: "acceptEdits",
        allowedTools: [
          "Read", "Write", "Edit", "Bash", "Glob",
          "WebSearch", "WebFetch", "Agent",
        ],
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
          const textParts: string[] = [];
          const toolParts: string[] = [];

          for (const block of blocks) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              toolParts.push(`🔧 ${block.name}`);
            }
          }

          const statusLines: string[] = [];
          if (toolParts.length) statusLines.push(toolParts.join(" | "));
          if (textParts.length) {
            const combined = textParts.join("\n");
            statusLines.push(
              combined.length > 500 ? "..." + combined.slice(-500) : combined
            );
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

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
import { IDENTITY_LINE_TASK } from "./identity.js";
import { loadPrompt } from "./prompts.js";
import { createLogger } from "../lib/log.js";
import type { CodexInputEntry } from "./codex.js";
import {
  codexInput,
  codexThreadOptions,
  formatCodexItemLine,
  getCodexClient,
  withCodexTimeout,
} from "./codex.js";
import { assertProviderSession, formatSessionId } from "./session.js";
import { fmtTokens, formatAnthropicUsage, formatCodexUsage } from "./usage.js";

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

const formatUsage = formatAnthropicUsage;

export const __testables = { fmtTokens, formatUsage, buildSupervisorBlock, IDENTITY_LINE_TASK };

export function buildSupervisorBlock(subagentNames: string[]): string {
  if (!subagentNames.length) return "";
  return loadPrompt("supervisor", { subagent_names: subagentNames.join(" / ") });
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

interface ExecuteTaskParams {
  taskId: string;
  prompt: string;
  cwd: string;
  channel: SendableChannels;
  resumeSessionId?: string;
  attachmentBlocks?: ContentBlockParam[];
  attachmentCodexInputs?: CodexInputEntry[];
  /**
   * "embed"（默认）：发 ✅ 任务完成 embed + 执行轨迹（/task 用）
   * "raw"：直接发 LLM 输出文本，无任何元数据装饰（cron / 程序化触发用）
   */
  outputMode?: "embed" | "raw";
}

function pushCompactedLine(lines: string[], line: string): boolean {
  const lastIdx = lines.length - 1;
  if (lastIdx >= 0) {
    const last = lines[lastIdx];
    const baseLast = last.replace(/\s+\(×\d+\)$/, "");
    if (baseLast === line) {
      const m = last.match(/\(×(\d+)\)$/);
      const next = m ? parseInt(m[1], 10) + 1 : 2;
      lines[lastIdx] = `${line} (×${next})`;
      return false;
    }
  }
  lines.push(line);
  return true;
}

async function updateProgressTail(
  progress: ProgressReporter,
  channel: SendableChannels,
  lines: string[],
): Promise<void> {
  const tail = lines.slice(-PROGRESS_TAIL_LINES);
  const omitted = lines.length - tail.length;
  const header = omitted > 0 ? `*…前 ${omitted} 步省略…*\n` : "";
  await progress.update((header + tail.join("\n")).slice(0, 1900), channel);
}

async function executeCodexTask(
  params: ExecuteTaskParams,
  progress: ProgressReporter,
  abortController: AbortController,
  startedAt: number,
  shortId: string,
): Promise<TaskResult> {
  const memoryBlock = buildMemoryPrompt();
  const identityLine = IDENTITY_LINE_TASK;
  const subagentNames = listSubagentNames();
  const supervisorBlock = buildSupervisorBlock(subagentNames);
  const resumeRawId = params.resumeSessionId ? assertProviderSession(params.resumeSessionId, "codex") : undefined;

  const prompt = [
    identityLine,
    supervisorBlock,
    memoryBlock,
    "你正在通过 Codex SDK 执行 MiniClaw 的 coding-agent 任务。请直接完成用户请求；需要修改文件时使用工作区内的工具，最后用中文给出结果和验证证据。",
    `<user_task>\n${params.prompt}\n</user_task>`,
  ].filter(Boolean).join("\n\n");

  const codex = getCodexClient();
  const threadOptions = codexThreadOptions("task", params.cwd);
  const thread = resumeRawId
    ? codex.resumeThread(resumeRawId, threadOptions)
    : codex.startThread(threadOptions);

  let sessionId = resumeRawId ? formatSessionId("codex", resumeRawId) : "";
  let finalResponse = "";
  let failedMessage = "";
  let tokensSummary: string | undefined;
  const toolCallLog: string[] = [];
  let toolStep = 0;
  let turns = 0;

  const timeoutCtrl = withCodexTimeout(abortController.signal, config.codex.timeoutMs);
  const { events } = await thread.runStreamed(
    codexInput(prompt, params.attachmentCodexInputs),
    { signal: timeoutCtrl.signal },
  );

  for await (const event of events) {
    if (abortController.signal.aborted || timeoutCtrl.signal.aborted) {
      failedMessage = abortController.signal.aborted ? "任务已被用户取消" : "Codex 执行超时";
      break;
    }

    switch (event.type) {
      case "thread.started": {
        sessionId = formatSessionId("codex", event.thread_id);
        updateTask(params.taskId, { session_id: sessionId });
        break;
      }
      case "turn.started": {
        turns++;
        break;
      }
      case "turn.completed": {
        tokensSummary = formatCodexUsage(event.usage);
        break;
      }
      case "turn.failed": {
        failedMessage = event.error.message;
        break;
      }
      case "error": {
        failedMessage = event.message;
        break;
      }
      case "item.started":
      case "item.updated":
      case "item.completed": {
        if (event.item.type === "agent_message") {
          finalResponse = event.item.text;
          break;
        }
        const line = formatCodexItemLine(event.item);
        if (line && pushCompactedLine(toolCallLog, line)) {
          toolStep++;
          await updateProgressTail(progress, params.channel, toolCallLog);
        }
        break;
      }
    }
  }

  if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();

  if (!sessionId && thread.id) {
    sessionId = formatSessionId("codex", thread.id);
    updateTask(params.taskId, { session_id: sessionId });
  }

  const lastResult: TaskResult = {
    success: !failedMessage,
    sessionId,
    costUsd: 0,
    durationMs: Date.now() - startedAt,
    turns: turns || 1,
    result: failedMessage || finalResponse.trim() || "[无文字回复]",
    ...(tokensSummary ? { tokensSummary } : {}),
  };

  await progress.complete(params.channel, lastResult.success ? undefined : { keepAsError: true });

  updateTask(params.taskId, {
    session_id: lastResult.sessionId,
    status: lastResult.success ? "completed" : "failed",
    result_summary: lastResult.result.slice(0, 10000),
    cost_usd: lastResult.costUsd,
    duration_ms: lastResult.durationMs,
    completed_at: new Date().toISOString(),
  });

  log.info(
    `${lastResult.success ? "✓" : "✗"} ${shortId} codex ${lastResult.success ? "done" : "failed"} ` +
    `turns=${lastResult.turns} wall=${lastResult.durationMs}ms tools=${toolStep}` +
    (lastResult.tokensSummary ? ` ${lastResult.tokensSummary}` : "")
  );

  const outputMode = params.outputMode ?? "embed";
  if (outputMode === "raw") {
    if (lastResult.success) {
      const chunks = chunkMessage(lastResult.result);
      for (const chunk of chunks) await params.channel.send(chunk);
    } else {
      await params.channel.send(`❌ \`${params.taskId.slice(0, 8)}\` 失败: ${lastResult.result.slice(0, 1900)}`);
    }
    return lastResult;
  }

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
    for (const chunk of chunks) await params.channel.send(chunk);
  }

  return lastResult;
}

export async function executeTask(params: ExecuteTaskParams): Promise<TaskResult> {
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
    if (config.agentProvider === "codex") {
      return await executeCodexTask(params, progress, abortController, startedAt, shortId);
    }

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const resumeRawId = resumeId ? assertProviderSession(resumeId, "claude") : undefined;
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
        model: config.claudeModel,
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
        ...(resumeRawId ? { resume: resumeRawId } : {}),
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
            sessionId = formatSessionId("claude", msg.session_id);
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
          sessionId = msg.session_id ? formatSessionId("claude", msg.session_id) : sessionId;
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

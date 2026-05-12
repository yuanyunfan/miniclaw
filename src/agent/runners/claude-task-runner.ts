import { config } from "../../config.js";
import { EASTMONEY_JYWG_TOOL_NAMES } from "../../mcp/eastmoney-jywg/safety.js";
import { FUTU_STOCK_TOOL_NAMES } from "../../mcp/futu-stock/safety.js";
import { buildMemoryPrompt } from "../../memory/inject.js";
import { IDENTITY_LINE_TASK } from "../identity.js";
import { loadMcpServers } from "../mcp.js";
import { assertProviderSession, formatSessionId } from "../session.js";
import { loadSubagents, listSubagentNames } from "../subagents.js";
import { buildSupervisorBlock } from "../supervisor.js";
import { formatAnthropicUsage } from "../usage.js";
import { taskViewEvents } from "../task-view-events.js";
import { pushCompactedLine } from "./progress-lines.js";
import type { TaskRunner, TaskRunnerResult } from "./types.js";

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

function allowedFutuStockMcpTools(mcpServers: Record<string, unknown>): string[] {
  return mcpServers["futu-stock"]
    ? FUTU_STOCK_TOOL_NAMES.map((name) => `mcp__futu-stock__${name}`)
    : [];
}

function allowedEastmoneyJywgMcpTools(mcpServers: Record<string, unknown>): string[] {
  return mcpServers["eastmoney-jywg"]
    ? EASTMONEY_JYWG_TOOL_NAMES.map((name) => `mcp__eastmoney-jywg__${name}`)
    : [];
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

function linkedAbortController(signal: AbortSignal): AbortController {
  const ctrl = new AbortController();
  const forwardAbort = () => ctrl.abort(signal.reason);
  if (signal.aborted) {
    forwardAbort();
    return ctrl;
  }
  signal.addEventListener("abort", forwardAbort, { once: true });
  return ctrl;
}

export const claudeTaskRunner: TaskRunner = {
  provider: "claude",
  async run(input): Promise<TaskRunnerResult> {
    const startedAt = Date.now();
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const resumeRawId = input.resumeSessionId ? assertProviderSession(input.resumeSessionId, "claude") : undefined;
    const memoryBlock = buildMemoryPrompt();
    const identityLine = IDENTITY_LINE_TASK;

    const subagentCalls: string[] = [];
    const SUBAGENT_PER_ROLE_CAP = parseInt(process.env.MINICLAW_SUBAGENT_ROLE_CAP ?? "4", 10);

    const subagents = loadSubagents();
    const subagentNames = listSubagentNames();
    const mcpServers = loadMcpServers();
    const supervisorBlock = buildSupervisorBlock(subagentNames);
    const claudeFlagSettings = config.claude.disableHooks
      ? { disableAllHooks: true as const }
      : undefined;

    const appendParts = [identityLine, supervisorBlock, memoryBlock].filter(Boolean);

    const hasAttachments = !!(input.attachmentBlocks && input.attachmentBlocks.length);
    const promptParam = hasAttachments
      ? (async function* () {
          yield {
            type: "user" as const,
            parent_tool_use_id: null,
            message: {
              role: "user" as const,
              content: [
                ...input.attachmentBlocks!,
                { type: "text" as const, text: input.prompt },
              ],
            },
          };
        })()
      : input.prompt;

    const abortController = linkedAbortController(input.signal);
    const q = query({
      prompt: promptParam,
      options: {
        model: config.claudeModel,
        cwd: input.cwd,
        permissionMode: "acceptEdits",
        settingSources: config.claude.settingSources,
        ...(claudeFlagSettings ? { settings: claudeFlagSettings } : {}),
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
          ...allowedEastmoneyJywgMcpTools(mcpServers),
          ...allowedFutuStockMcpTools(mcpServers),
        ],
        agents: subagents,
        ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
        canUseTool: async (toolName, toolInput) => {
          const skillName = (toolInput as { skill?: string }).skill;
          const BLOCKED_SKILLS = new Set(["triad", "triad-resume"]);
          if (toolName === "Skill" && skillName && BLOCKED_SKILLS.has(skillName)) {
            return {
              behavior: "deny" as const,
              message: `${skillName} 在 miniclaw 中被禁用（它是面向 CLI 交互的 slash command，与 SDK Discord bot 流程不匹配）。请改用项目角色化 subagent 完成多阶段任务。`,
            };
          }
          if (toolName === "Agent" || toolName === "Task") {
            const role = String((toolInput as { subagent_type?: string }).subagent_type ?? "general");
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
            const cmd = String((toolInput as { command?: string }).command ?? "");
            const DESTRUCTIVE = /\b(rm\s+-rf?\s+\/(?!tmp\/|var\/folders\/)|sudo\b|npm\s+publish|pnpm\s+publish|git\s+push\s+--force(?!-with-lease))\b/;
            if (DESTRUCTIVE.test(cmd)) {
              return {
                behavior: "deny" as const,
                message: `Bash 命令被拒绝：检测到高风险破坏性操作 (${cmd.slice(0, 80)})。如确需执行，请由用户手动操作。`,
              };
            }
          }
          return { behavior: "allow" as const, updatedInput: toolInput };
        },
        ...(config.defaultMaxTurns !== undefined ? { maxTurns: config.defaultMaxTurns } : {}),
        ...(config.defaultBudgetUsd !== undefined ? { maxBudgetUsd: config.defaultBudgetUsd } : {}),
        abortController,
        ...(resumeRawId ? { resume: resumeRawId } : {}),
      },
    });

    let sessionId = "";
    let lastResult: TaskRunnerResult | null = null;
    const progressLines: string[] = [];
    let toolStep = 0;

    const emitSessionStarted = async (nextSessionId: string) => {
      sessionId = nextSessionId;
      await input.onViewEvent(taskViewEvents.sessionStarted("claude", sessionId));
      input.onTraceEvent("session_started", {
        message: sessionId,
        payload: { provider: "claude", session_id: sessionId },
      });
    };

    for await (const msg of q) {
      if (input.signal.aborted) {
        lastResult = {
          success: false,
          sessionId,
          costUsd: 0,
          durationMs: Date.now() - startedAt,
          turns: 0,
          result: "任务已被用户取消",
          progressLines,
          toolCount: toolStep,
        };
        break;
      }

      switch (msg.type) {
        case "system": {
          if ("session_id" in msg && msg.session_id) {
            await emitSessionStarted(formatSessionId("claude", msg.session_id));
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
            const blockInput = (block.input ?? {}) as Record<string, unknown>;
            const icon = toolIcon(block.name);
            const short = toolShortName(block.name);
            const detail = formatToolDetail(block.name, blockInput);
            const display = detail.length > 60 ? detail.slice(0, 60) + "..." : detail;
            const line = `${indent}${icon} ${short}${display ? `: "${display}"` : ""}`;

            const added = pushCompactedLine(progressLines, line);
            if (added) {
              input.onTraceEvent("tool_event", {
                message: line,
                payload: {
                  provider: "claude",
                  tool_name: block.name,
                  parent_tool_use_id: parentId,
                },
              });
            }
            await input.onViewEvent(taskViewEvents.toolProgress({
              provider: "claude",
              title: line,
              countAsTool: true,
            }));
          }
          break;
        }

        case "result": {
          const costUsd = msg.subtype === "success" ? msg.total_cost_usd : 0;
          const durationMs = msg.duration_ms;
          const turns = msg.num_turns;
          const resultText = msg.subtype === "success"
            ? msg.result
            : ("errors" in msg ? msg.errors.join("\n") : "Unknown error");
          sessionId = msg.session_id ? formatSessionId("claude", msg.session_id) : sessionId;
          const tokensSummary = formatAnthropicUsage((msg as { usage?: unknown }).usage);

          lastResult = {
            success: msg.subtype === "success",
            sessionId,
            costUsd,
            durationMs,
            turns,
            result: resultText,
            ...(tokensSummary ? { tokensSummary } : {}),
            progressLines,
            toolCount: toolStep,
          };
          if (!lastResult.success) {
            await input.onViewEvent(taskViewEvents.providerError("claude", resultText, msg.subtype));
            input.onTraceEvent("provider_error", {
              severity: "error",
              message: resultText,
              payload: { provider: "claude", subtype: msg.subtype },
            });
          }
          break;
        }
      }
    }

    if (!lastResult) {
      lastResult = {
        success: false,
        sessionId,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
        turns: 0,
        result: input.signal.aborted ? "任务已被用户取消" : "任务被中断或无结果",
        progressLines,
        toolCount: toolStep,
      };
    }

    await input.onViewEvent(lastResult.success
      ? taskViewEvents.taskCompleted(lastResult)
      : taskViewEvents.taskFailed(lastResult.result));

    return lastResult;
  },
};

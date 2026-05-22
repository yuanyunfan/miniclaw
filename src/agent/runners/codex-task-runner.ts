import { config } from "../../config.js";
import { formatTaskPromptForSystem } from "../../routing/task-context.js";
import { buildMemoryPrompt } from "../../memory/inject.js";
import { IDENTITY_LINE_TASK } from "../identity.js";
import { listSubagentNames } from "../subagents.js";
import { buildSupervisorBlock } from "../supervisor.js";
import { assertProviderSession, formatSessionId } from "../session.js";
import { formatCodexUsage } from "../usage.js";
import {
  type CodexClientOverrides,
  codexInput,
  codexThreadOptions,
  formatCodexItemLine,
  getCodexClient,
  withCodexTimeout,
} from "../codex.js";
import { taskViewEvents } from "../task-view-events.js";
import { pushCompactedLine } from "./progress-lines.js";
import type { TaskRunner, TaskRunnerResult } from "./types.js";
import type { AgentTaskManagedContext } from "../../runtime/agent-runtime.js";
import { isDangerousManagedShellCommand } from "../run-manager/role-policy.js";

export function codexManagedAgentBusOverrides(managedContext: AgentTaskManagedContext | undefined): CodexClientOverrides | undefined {
  const agentBus = managedContext?.agentBusMcp;
  if (!agentBus) return undefined;
  const { serverConfig } = agentBus;
  return {
    config: {
      mcp_servers: {
        [agentBus.serverName]: {
          enabled: true,
          command: serverConfig.command,
          ...(serverConfig.args ? { args: serverConfig.args } : {}),
          ...(serverConfig.env ? { env: serverConfig.env } : {}),
        },
      },
    },
  };
}

export function codexManagedRolePolicyViolation(
  managedContext: AgentTaskManagedContext | undefined,
  item: { type: string } & Record<string, unknown>,
): string | undefined {
  const rolePolicy = managedContext?.rolePolicy;
  if (!rolePolicy) return undefined;
  if (item.type === "command_execution") {
    const command = String((item as { command?: string }).command ?? "");
    if (rolePolicy.codex.denyDangerousCommands && isDangerousManagedShellCommand(command)) {
      return `Codex managed role policy ${rolePolicy.toolPolicyId} denied dangerous command: ${command.slice(0, 100)}`;
    }
  }
  if (item.type === "file_change" && !rolePolicy.canWriteWorkspace) {
    return `Codex managed role policy ${rolePolicy.toolPolicyId} denied workspace file changes for read-only role ${managedContext.role}`;
  }
  return undefined;
}

export const codexTaskRunner: TaskRunner = {
  provider: "codex",
  async run(input): Promise<TaskRunnerResult> {
    const startedAt = Date.now();
    const memoryBlock = buildMemoryPrompt();
    const identityLine = IDENTITY_LINE_TASK;
    const subagentNames = listSubagentNames();
    const supervisorBlock = buildSupervisorBlock(subagentNames);
    const resumeRawId = input.resumeSessionId ? assertProviderSession(input.resumeSessionId, "codex") : undefined;

    const prompt = [
      identityLine,
      supervisorBlock,
      memoryBlock,
      "你正在通过 Codex SDK 执行 MiniClaw 的 coding-agent 任务。请直接完成用户请求；需要修改文件时使用工作区内的工具，最后用中文给出结果和验证证据。",
      formatTaskPromptForSystem(input.prompt),
    ].filter(Boolean).join("\n\n");

    const codex = getCodexClient(codexManagedAgentBusOverrides(input.managedContext));
    const threadOptions = codexThreadOptions("task", input.cwd, input.managedContext, input.runtimeOverride);
    const thread = resumeRawId
      ? codex.resumeThread(resumeRawId, threadOptions)
      : codex.startThread(threadOptions);

    let sessionId = resumeRawId ? formatSessionId("codex", resumeRawId) : "";
    let finalResponse = "";
    let failedMessage = "";
    let tokensSummary: string | undefined;
    const progressLines: string[] = [];
    let toolStep = 0;
    let turns = 0;

    const emitSessionStarted = async (nextSessionId: string) => {
      sessionId = nextSessionId;
      await input.onViewEvent(taskViewEvents.sessionStarted("codex", sessionId));
      input.onTraceEvent("session_started", {
        message: sessionId,
        payload: { provider: "codex", session_id: sessionId },
      });
    };

    const timeoutCtrl = withCodexTimeout(input.signal, config.codex.timeoutMs);
    const { events } = await thread.runStreamed(
      codexInput(prompt, input.attachmentCodexInputs),
      { signal: timeoutCtrl.signal },
    );

    for await (const event of events) {
      if (input.signal.aborted || timeoutCtrl.signal.aborted) {
        if (!failedMessage) failedMessage = input.signal.aborted ? "任务已被用户取消" : "Codex 执行超时";
        break;
      }

      switch (event.type) {
        case "thread.started": {
          await emitSessionStarted(formatSessionId("codex", event.thread_id));
          break;
        }
        case "turn.started": {
          turns++;
          await input.onViewEvent(taskViewEvents.turnStarted("codex", turns));
          input.onTraceEvent("turn_started", { payload: { provider: "codex", turn: turns } });
          break;
        }
        case "turn.completed": {
          tokensSummary = formatCodexUsage(event.usage);
          input.onTraceEvent("turn_completed", { payload: { provider: "codex", turn: turns, usage: event.usage } });
          break;
        }
        case "turn.failed": {
          failedMessage = event.error.message;
          await input.onViewEvent(taskViewEvents.providerError("codex", failedMessage, event.type));
          input.onTraceEvent("provider_error", {
            severity: "error",
            message: failedMessage,
            payload: { provider: "codex", event_type: event.type },
          });
          break;
        }
        case "error": {
          failedMessage = event.message;
          await input.onViewEvent(taskViewEvents.providerError("codex", failedMessage, event.type));
          input.onTraceEvent("provider_error", {
            severity: "error",
            message: failedMessage,
            payload: { provider: "codex", event_type: event.type },
          });
          break;
        }
        case "item.started":
        case "item.updated":
        case "item.completed": {
          if (event.item.type === "agent_message") {
            finalResponse = event.item.text;
            break;
          }
          const policyViolation = codexManagedRolePolicyViolation(input.managedContext, event.item);
          if (policyViolation) {
            failedMessage = policyViolation;
            timeoutCtrl.abort(new Error(policyViolation));
            await input.onViewEvent(taskViewEvents.providerError("codex", policyViolation, "managed_role_policy"));
            input.onTraceEvent("provider_error", {
              severity: "error",
              message: policyViolation,
              payload: { provider: "codex", event_type: "managed_role_policy" },
            });
            break;
          }
          const line = formatCodexItemLine(event.item);
          if (!line) break;

          const added = pushCompactedLine(progressLines, line);
          if (added) {
            toolStep++;
            input.onTraceEvent("tool_event", {
              message: line,
              payload: { provider: "codex", item_type: event.item.type, stream_event: event.type },
            });
          }
          await input.onViewEvent(taskViewEvents.toolProgress({
            provider: "codex",
            title: line,
            countAsTool: added,
          }));
          break;
        }
      }
    }

    if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();

    if (!sessionId && thread.id) {
      await emitSessionStarted(formatSessionId("codex", thread.id));
    }

    const result: TaskRunnerResult = {
      success: !failedMessage && !input.signal.aborted,
      sessionId,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      turns: turns || 1,
      result: input.signal.aborted
        ? "任务已被用户取消"
        : failedMessage || finalResponse.trim() || "[无文字回复]",
      ...(tokensSummary ? { tokensSummary } : {}),
      progressLines,
      toolCount: toolStep,
    };

    await input.onViewEvent(result.success
      ? taskViewEvents.taskCompleted(result)
      : taskViewEvents.taskFailed(result.result));

    return result;
  },
};

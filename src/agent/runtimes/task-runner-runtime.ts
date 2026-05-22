import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { AgentRuntime, AgentTaskInput, AgentTaskResumeInput } from "../../runtime/agent-runtime.js";
import type { CodexInputEntry } from "../codex.js";
import type { TaskRunner, TaskRunnerInput } from "../runners/types.js";

export function createTaskRunnerRuntime(params: {
  id: "claude" | "codex";
  runner: TaskRunner;
}): AgentRuntime {
  const toRunnerInput = (input: AgentTaskInput): TaskRunnerInput => ({
    taskId: input.taskId,
    prompt: input.prompt,
    cwd: input.cwd,
    ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
    ...(input.attachments?.contentBlocks
      ? { attachmentBlocks: input.attachments.contentBlocks as ContentBlockParam[] }
      : {}),
    ...(input.attachments?.inputEntries
      ? { attachmentCodexInputs: input.attachments.inputEntries as CodexInputEntry[] }
      : {}),
    ...(input.managedContext ? { managedContext: input.managedContext } : {}),
    ...(input.runtimeOverride ? { runtimeOverride: input.runtimeOverride } : {}),
    signal: input.signal,
    onViewEvent: input.onViewEvent,
    onTraceEvent: input.onTraceEvent,
  });

  const startTask = (input: AgentTaskInput) => params.runner.run(toRunnerInput(input));

  return {
    id: params.id,
    kind: "coding_agent",
    capabilities: {
      resumeSession: true,
      cancel: true,
      toolEvents: true,
      workspaceWrite: true,
    },
    startTask,
    resumeTask: (input: AgentTaskResumeInput) => startTask(input),
  };
}

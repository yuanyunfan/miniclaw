import type { AgentProvider } from "../../config.js";
import { buildFakeTaskResult } from "../../e2e/fake-agent.js";
import { taskViewEvents } from "../task-view-events.js";
import type { TaskRunner, TaskRunnerResult } from "./types.js";

export function createFakeTaskRunner(sessionProvider: AgentProvider): TaskRunner {
  return {
    provider: "fake",
    async run(input): Promise<TaskRunnerResult> {
      const startedAt = Date.now();
      if (input.signal.aborted) {
        const result: TaskRunnerResult = {
          success: false,
          sessionId: "",
          costUsd: 0,
          durationMs: Date.now() - startedAt,
          turns: 0,
          result: "任务已被用户取消",
          progressLines: [],
          toolCount: 0,
        };
        await input.onViewEvent(taskViewEvents.taskFailed(result.result));
        return result;
      }

      const fake = buildFakeTaskResult(input.prompt, sessionProvider);
      const result: TaskRunnerResult = {
        success: true,
        sessionId: fake.sessionId,
        costUsd: 0,
        durationMs: Date.now() - startedAt + fake.durationMs,
        turns: 1,
        result: fake.reply,
        tokensSummary: fake.tokensSummary,
        progressLines: ["🧪 e2e fake agent"],
        toolCount: 0,
      };

      await input.onViewEvent(taskViewEvents.sessionStarted(sessionProvider, result.sessionId));
      input.onTraceEvent("session_started", {
        message: result.sessionId,
        payload: { provider: sessionProvider, session_id: result.sessionId },
      });
      await input.onViewEvent(taskViewEvents.taskCompleted(result));

      return result;
    },
  };
}

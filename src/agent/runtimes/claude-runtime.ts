import { claudeTaskRunner } from "../runners/claude-task-runner.js";
import { createTaskRunnerRuntime } from "./task-runner-runtime.js";

export const claudeAgentRuntime = createTaskRunnerRuntime({
  id: "claude",
  runner: claudeTaskRunner,
});

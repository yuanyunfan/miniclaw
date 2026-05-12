import { codexTaskRunner } from "../runners/codex-task-runner.js";
import { createTaskRunnerRuntime } from "./task-runner-runtime.js";

export const codexAgentRuntime = createTaskRunnerRuntime({
  id: "codex",
  runner: codexTaskRunner,
});

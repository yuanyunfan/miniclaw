import { config } from "../../config.js";
import {
  codexInput,
  codexThreadOptions,
  formatCodexItemLine,
  getCodexClient,
  withCodexTimeout,
} from "../../agent/codex.js";

export interface RepairAgentResult {
  success: boolean;
  threadId?: string;
  response: string;
  toolLog: string[];
  error?: string;
}

export async function runCodexRepairAgent(prompt: string, cwd: string): Promise<RepairAgentResult> {
  const ctrl = new AbortController();
  const timeoutCtrl = withCodexTimeout(ctrl.signal, config.codex.timeoutMs);
  const codex = getCodexClient();
  const thread = codex.startThread(codexThreadOptions("task", cwd));
  const toolLog: string[] = [];
  let response = "";
  let error: string | undefined;
  const { events } = await thread.runStreamed(codexInput(prompt), { signal: timeoutCtrl.signal });

  for await (const event of events) {
    if (timeoutCtrl.signal.aborted) {
      error = `Codex timeout after ${config.codex.timeoutMs}ms`;
      break;
    }
    switch (event.type) {
      case "turn.failed":
        error = event.error.message;
        break;
      case "error":
        error = event.message;
        break;
      case "item.started":
      case "item.updated":
      case "item.completed":
        if (event.item.type === "agent_message") response = event.item.text;
        else {
          const line = formatCodexItemLine(event.item);
          if (line) toolLog.push(line);
        }
        break;
    }
  }

  if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort();
  return {
    success: !error,
    response: response.trim(),
    toolLog,
    ...(thread.id ? { threadId: thread.id } : {}),
    ...(error ? { error } : {}),
  };
}

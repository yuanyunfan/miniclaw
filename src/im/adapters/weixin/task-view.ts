import type { TaskResult } from "../../../agent/task.js";
import type { TaskTerminalStatus, TaskViewProgressSnapshot, TaskViewReporter } from "../../../agent/task-view.js";
import type { TaskViewEvent } from "../../../agent/task-view-events.js";
import { createLogger } from "../../../lib/log.js";

const PROGRESS_INTERVAL_MS = 15_000;
const MAX_WEIXIN_CHARS = 3500;
const SEND_RETRY_DELAY_MS = 1_000;

const log = createLogger("weixin-task-view");

interface ViewProgressState {
  lines: string[];
  turns: number;
  toolCount: number;
}

export interface WeixinTaskViewReporterOptions {
  taskId: string;
  prompt: string;
  cwd: string;
  send: (text: string) => Promise<void>;
  progressIntervalMs?: number;
  sendRetryDelayMs?: number;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function taskViewProgressLine(event: Extract<TaskViewEvent, { type: "tool_progress" | "assistant_progress" }>): string {
  if (event.type === "assistant_progress") return event.text;
  return event.detail ? `${event.title}: "${event.detail}"` : event.title;
}

function pushCompactedViewLine(lines: string[], line: string): boolean {
  const lastIdx = lines.length - 1;
  if (lastIdx >= 0) {
    const last = lines[lastIdx];
    const baseLast = last.replace(/\s+\(x\d+\)$/, "");
    if (baseLast === line) {
      const m = last.match(/\(x(\d+)\)$/);
      const next = m ? parseInt(m[1], 10) + 1 : 2;
      lines[lastIdx] = `${line} (x${next})`;
      return false;
    }
  }
  lines.push(line);
  return true;
}

function chunks(text: string): string[] {
  const clean = text.trim() || "[无文字回复]";
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += MAX_WEIXIN_CHARS) out.push(clean.slice(i, i + MAX_WEIXIN_CHARS));
  return out.length ? out : ["[无文字回复]"];
}

function resultHeader(taskId: string, status: TaskTerminalStatus, result: TaskResult, toolCount: number): string {
  const ok = status === "completed";
  return [
    `${ok ? "✅" : "❌"} MiniClaw task ${taskId.slice(0, 8)} ${ok ? "已完成" : `结束：${status}`}`,
    `耗时：${formatSeconds(result.durationMs)} · turns：${result.turns} · tools：${toolCount}`,
    ...(result.tokensSummary ? [`tokens：${result.tokensSummary}`] : []),
  ].join("\n");
}

export class WeixinTaskViewReporter implements TaskViewReporter {
  private readonly state: ViewProgressState = { lines: [], turns: 0, toolCount: 0 };
  private lastProgressAt = 0;
  private readonly progressIntervalMs: number;
  private readonly sendRetryDelayMs: number;

  constructor(private readonly options: WeixinTaskViewReporterOptions) {
    this.progressIntervalMs = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    this.sendRetryDelayMs = options.sendRetryDelayMs ?? SEND_RETRY_DELAY_MS;
  }

  private sendBestEffort(text: string, stage: string): void {
    void Promise.resolve().then(() => this.options.send(text)).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`task ${this.options.taskId.slice(0, 8)} ${stage} send failed; retrying once: ${message}`);
      void retryAfter(this.sendRetryDelayMs, () => this.options.send(text)).catch((retryErr) => {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        log.warn(`task ${this.options.taskId.slice(0, 8)} ${stage} retry failed; suppressing delivery error: ${retryMessage}`);
      });
    });
  }

  async start(): Promise<void> {
    this.sendBestEffort(
      [
        `▶ MiniClaw task ${this.options.taskId.slice(0, 8)} 开始执行`,
        `cwd：${this.options.cwd}`,
        `任务：${this.options.prompt.slice(0, 500)}`,
      ].join("\n"),
      "start",
    );
  }

  async handle(event: TaskViewEvent): Promise<void> {
    switch (event.type) {
      case "turn_started":
        this.state.turns = event.turn;
        return;
      case "tool_progress":
      case "assistant_progress": {
        const line = taskViewProgressLine(event);
        const added = pushCompactedViewLine(this.state.lines, line);
        if (event.type === "tool_progress" && event.countAsTool !== false) this.state.toolCount++;
        const now = Date.now();
        if (added && now - this.lastProgressAt >= this.progressIntervalMs) {
          this.lastProgressAt = now;
          this.sendBestEffort(
            [
              `⏳ task ${this.options.taskId.slice(0, 8)} 执行中`,
              `turns：${this.state.turns || 0} · tools：${this.state.toolCount}`,
              `最近步骤：${line}`,
            ].join("\n"),
            "progress",
          );
        }
        return;
      }
      default:
        return;
    }
  }

  snapshot(): TaskViewProgressSnapshot {
    return {
      lines: [...this.state.lines],
      turns: this.state.turns,
      toolCount: this.state.toolCount,
    };
  }

  async finish(
    result: TaskResult,
    status: TaskTerminalStatus,
    progressSnapshot: Partial<Pick<TaskViewProgressSnapshot, "lines" | "toolCount">> = {},
  ): Promise<void> {
    const toolCount = progressSnapshot.toolCount ?? this.state.toolCount;
    const header = resultHeader(this.options.taskId, status, result, toolCount);
    const body = result.success
      ? result.result.trim() || "[无文字回复]"
      : `任务失败：${result.result.trim() || "unknown error"}`;
    for (const [idx, chunk] of chunks(body).entries()) {
      this.sendBestEffort(idx === 0 ? `${header}\n\n${chunk}` : chunk, "finish");
    }
  }

  async renderTaskError(message: string): Promise<void> {
    this.sendBestEffort(`❌ MiniClaw task ${this.options.taskId.slice(0, 8)} 出错：${message.slice(0, 3000)}`, "error");
  }
}

async function retryAfter(ms: number, send: () => Promise<void>): Promise<void> {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  await send();
}

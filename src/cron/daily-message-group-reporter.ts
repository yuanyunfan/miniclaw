import type { SendableChannels } from "discord.js";
import type { TaskResult } from "../agent/task.js";
import type { TaskTerminalStatus, TaskViewProgressSnapshot, TaskViewReporter } from "../agent/task-view.js";
import type { TaskViewEvent } from "../agent/task-view-events.js";
import { rawTaskMessages } from "../discord/task-view-reporter.js";
import { sendChunkedTextWithDeferredLinkPreviews } from "../discord/text.js";
import { enqueueTaskResultDelivery } from "../monitoring/recovery-outbox.js";
import { deliverDailyMessageGroup } from "./daily-message-group.js";

export interface DailyMessageGroupReporterOptions {
  taskId: string;
  channel: SendableChannels;
  channelId: string;
  jobName: string;
  runAt: Date;
  timezone: string;
  route?: string;
  onDeliveryError?: (operation: string, err: unknown) => void;
}

export class DailyMessageGroupReporter implements TaskViewReporter {
  constructor(private readonly options: DailyMessageGroupReporterOptions) {}

  async start(): Promise<void> {
    return undefined;
  }

  async handle(_event: TaskViewEvent): Promise<void> {
    return undefined;
  }

  snapshot(): TaskViewProgressSnapshot {
    return { lines: [], turns: 0, toolCount: 0 };
  }

  async finish(result: TaskResult, _status: TaskTerminalStatus): Promise<void> {
    try {
      if (result.success) {
        await deliverDailyMessageGroup({
          channel: this.options.channel,
          jobName: this.options.jobName,
          channelId: this.options.channelId,
          taskId: this.options.taskId,
          text: result.result.trim() || "[无文字回复]",
          runAt: this.options.runAt,
          timezone: this.options.timezone,
        });
        return;
      }

      const [message = `❌ \`${this.options.taskId.slice(0, 8)}\` 失败`] = rawTaskMessages(this.options.taskId, result);
      await sendChunkedTextWithDeferredLinkPreviews(this.options.channel, message);
    } catch (err) {
      this.options.onDeliveryError?.("daily_message_group_delivery", err);
      try {
        enqueueTaskResultDelivery({
          channelId: this.options.channelId,
          taskId: this.options.taskId,
          messages: rawTaskMessages(this.options.taskId, result),
          success: result.success,
          durationMs: result.durationMs,
          route: this.options.route,
          jobName: this.options.jobName,
          deliveryError: err instanceof Error ? err.message : String(err),
        });
      } catch (queueErr) {
        this.options.onDeliveryError?.("daily_message_group_delivery_enqueue", queueErr);
      }
    }
  }

  async renderTaskError(message: string): Promise<void> {
    try {
      await this.options.channel.send(`❌ \`${this.options.taskId.slice(0, 8)}\` 失败: ${message.slice(0, 1900)}`);
    } catch (err) {
      this.options.onDeliveryError?.("daily_message_group_error_send", err);
    }
  }
}

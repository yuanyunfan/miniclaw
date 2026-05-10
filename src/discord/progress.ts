import type { Message, SendableChannels } from "discord.js";
import { updateTask } from "../store/db.js";

interface ProgressReporterOptions {
  minUpdateIntervalMs?: number;
  onDeliveryError?: (operation: "send" | "edit" | "delete", err: unknown) => void;
}

export class ProgressReporter {
  private statusMessage: Message | null = null;
  private lastUpdate = 0;
  private pendingText = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private taskId: string | null;
  private messageIdPersisted = false;
  private minUpdateIntervalMs: number;
  private onDeliveryError?: ProgressReporterOptions["onDeliveryError"];

  constructor(taskId?: string, options: ProgressReporterOptions = {}) {
    this.taskId = taskId ?? null;
    this.minUpdateIntervalMs = options.minUpdateIntervalMs ?? 2000;
    this.onDeliveryError = options.onDeliveryError;
  }

  async update(text: string, channel: SendableChannels): Promise<void> {
    this.pendingText = text.slice(0, 2000);
    const now = Date.now();
    if (now - this.lastUpdate < this.minUpdateIntervalMs) {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(channel), this.minUpdateIntervalMs);
      return;
    }
    await this.flush(channel);
  }

  private async flush(channel: SendableChannels): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pendingText) return;
    this.lastUpdate = Date.now();
    try {
      if (this.statusMessage) {
        await this.statusMessage.edit(this.pendingText);
      } else {
        this.statusMessage = await channel.send(this.pendingText);
        if (this.taskId && !this.messageIdPersisted) {
          this.messageIdPersisted = true;
          try {
            updateTask(this.taskId, { progress_message_id: this.statusMessage.id });
          } catch {
            // best-effort persistence; do not break the task on DB write failure
          }
        }
      }
    } catch (err) {
      this.onDeliveryError?.(this.statusMessage ? "edit" : "send", err);
      this.statusMessage = null;
    }
  }

  async complete(_channel: SendableChannels, opts?: { keepAsError?: boolean; finalText?: string }): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    try {
      if (!this.statusMessage) return;
      if (opts?.finalText) {
        await this.statusMessage.edit(opts.finalText.slice(0, 2000));
      } else if (opts?.keepAsError) {
        const current = this.statusMessage.content ?? "";
        const suffix = "\n\n❌ 任务异常终止";
        const next = (current + suffix).slice(0, 2000);
        await this.statusMessage.edit(next);
      } else {
        await this.statusMessage.delete();
      }
    } catch (err) {
      this.onDeliveryError?.(opts?.finalText || opts?.keepAsError ? "edit" : "delete", err);
      // already deleted / unable to edit
    }
    this.statusMessage = null;
  }
}

import type { Message, TextChannel } from "discord.js";

export class ProgressReporter {
  private statusMessage: Message | null = null;
  private lastUpdate = 0;
  private pendingText = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  async update(text: string, channel: TextChannel): Promise<void> {
    this.pendingText = text.slice(0, 2000);
    const now = Date.now();
    if (now - this.lastUpdate < 500) {
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(channel), 500);
      }
      return;
    }
    await this.flush(channel);
  }

  private async flush(channel: TextChannel): Promise<void> {
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
      }
    } catch {
      // message may have been deleted
      this.statusMessage = null;
    }
  }

  async complete(channel: TextChannel): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    try {
      if (this.statusMessage) await this.statusMessage.delete();
    } catch {
      // already deleted
    }
    this.statusMessage = null;
  }
}

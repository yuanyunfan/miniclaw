import type {
  Client,
  MessageCreateOptions,
  MessageEditOptions,
  SendableChannels,
} from "discord.js";
import { listCliSessions, listPendingCliSessionApprovals } from "../store/db.js";
import { createLogger, type Logger } from "../lib/log.js";
import { resolveSendableChannel } from "./channel-resolver.js";
import { buildCliSessionDashboardMessage } from "./cli-session-dashboard.js";
import type { CliSessionApprovalRow, CliSessionRow } from "../hookd/types.js";

const log = createLogger("cli-session-dashboard-updater");

export interface CliSessionDashboardUpdaterConfig {
  channelId?: string;
  channelName?: string;
  messageId?: string;
  updateDebounceMs: number;
  dashboardLimit: number;
  staleActiveMs: number;
  liveTerminalContinueEnabled: boolean;
  guildId?: string;
}

export interface CliSessionDashboardState {
  sessions: CliSessionRow[];
  pendingApprovals: Record<string, CliSessionApprovalRow | undefined>;
}

interface DashboardMessage {
  id: string;
  edit: (payload: MessageEditOptions) => Promise<unknown>;
  pin?: (reason?: string) => Promise<unknown>;
}

type DashboardChannel = SendableChannels & {
  id: string;
  send: (payload: MessageCreateOptions) => Promise<DashboardMessage>;
  messages?: {
    fetch: (messageId: string) => Promise<DashboardMessage>;
  };
};

export interface CliSessionDashboardUpdaterDependencies {
  loadState?: () => CliSessionDashboardState;
  resolveChannel?: typeof resolveSendableChannel;
  logger?: Logger;
  now?: () => Date;
}

function defaultLoadState(): CliSessionDashboardState {
  return {
    sessions: listCliSessions({ limit: 200 }),
    pendingApprovals: Object.fromEntries(
      listPendingCliSessionApprovals(200).map((approval) => [approval.cli_session_id, approval])
    ),
  };
}

function asDashboardChannel(channel: SendableChannels): DashboardChannel {
  return channel as unknown as DashboardChannel;
}

function buildPayload(state: CliSessionDashboardState, config: CliSessionDashboardUpdaterConfig, now: Date) {
  const message = buildCliSessionDashboardMessage({
    sessions: state.sessions,
    staleActiveMs: config.staleActiveMs,
    limit: config.dashboardLimit,
    pendingApprovals: state.pendingApprovals,
    now,
    liveTerminalContinueEnabled: config.liveTerminalContinueEnabled,
  });
  return {
    embeds: message.embeds,
    components: message.components,
    allowedMentions: { parse: [] },
  } as MessageCreateOptions & MessageEditOptions;
}

export class CliSessionDashboardUpdater {
  private channel: DashboardChannel | null = null;
  private messageId: string | undefined;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInFlight = false;
  private refreshPending = false;
  private stopped = false;
  private readonly loadState: () => CliSessionDashboardState;
  private readonly resolveChannel: typeof resolveSendableChannel;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(
    private readonly client: Client,
    private readonly config: CliSessionDashboardUpdaterConfig,
    dependencies: CliSessionDashboardUpdaterDependencies = {},
  ) {
    this.messageId = config.messageId;
    this.loadState = dependencies.loadState ?? defaultLoadState;
    this.resolveChannel = dependencies.resolveChannel ?? resolveSendableChannel;
    this.logger = dependencies.logger ?? log;
    this.now = dependencies.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    const channel = await this.resolveChannel(this.client, {
      id: this.config.channelId,
      name: this.config.channelName,
      guildId: this.config.guildId,
      purpose: "CLI session dashboard",
    });
    if (!channel) {
      this.logger.warn("CLI session dashboard updater not started; target channel unavailable");
      return;
    }
    this.channel = asDashboardChannel(channel);
    this.logger.info(
      `CLI session dashboard updater started for channel ${this.channel.id}` +
      (this.messageId ? ` message ${this.messageId}` : "")
    );
    await this.refreshNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  scheduleRefresh(): void {
    if (this.stopped || !this.channel) return;
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.flushRefresh();
    }, this.config.updateDebounceMs);
    this.refreshTimer.unref?.();
  }

  async refreshNow(): Promise<void> {
    if (this.stopped || !this.channel) return;
    const state = this.loadState();
    const payload = buildPayload(state, this.config, this.now());
    const edited = await this.tryEditExistingMessage(payload);
    if (edited) return;

    const created = await this.channel.send(payload);
    this.messageId = created.id;
    await this.pinCreatedMessage(created);
    this.logger.warn(
      `created CLI session dashboard message ${created.id}; set hookd.dashboard_message_id to keep editing it across restarts`
    );
  }

  private async flushRefresh(): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshPending = true;
      return;
    }
    this.refreshInFlight = true;
    try {
      do {
        this.refreshPending = false;
        await this.refreshNow();
      } while (this.refreshPending && !this.stopped);
    } finally {
      this.refreshInFlight = false;
    }
  }

  private async tryEditExistingMessage(payload: MessageEditOptions): Promise<boolean> {
    if (!this.channel || !this.messageId) return false;
    if (!this.channel.messages) {
      this.logger.warn("CLI session dashboard channel does not expose a message manager; creating a replacement message");
      return false;
    }

    let message: DashboardMessage;
    try {
      message = await this.channel.messages.fetch(this.messageId);
    } catch (err) {
      this.logger.warn(`failed to fetch CLI session dashboard message ${this.messageId}; creating replacement:`, err);
      return false;
    }

    try {
      await message.edit(payload);
      this.messageId = message.id;
      return true;
    } catch (err) {
      this.logger.warn(`failed to edit CLI session dashboard message ${message.id}; creating replacement:`, err);
      return false;
    }
  }

  private async pinCreatedMessage(message: DashboardMessage): Promise<void> {
    if (!message.pin) return;
    try {
      await message.pin("MiniClaw CLI session dashboard");
    } catch (err) {
      this.logger.warn(`failed to pin CLI session dashboard message ${message.id}:`, err);
    }
  }
}

export function startCliSessionDashboardUpdater(
  client: Client,
  config: CliSessionDashboardUpdaterConfig,
  dependencies?: CliSessionDashboardUpdaterDependencies,
): CliSessionDashboardUpdater {
  const updater = new CliSessionDashboardUpdater(client, config, dependencies);
  void updater.start().catch((err) => {
    (dependencies?.logger ?? log).error("CLI session dashboard updater failed to start:", err);
  });
  return updater;
}

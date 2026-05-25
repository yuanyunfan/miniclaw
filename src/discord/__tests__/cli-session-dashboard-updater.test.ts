import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import {
  CliSessionDashboardUpdater,
  type CliSessionDashboardUpdaterConfig,
} from "../cli-session-dashboard-updater.js";
import type { CliSessionRow } from "../../hookd/types.js";
import type { Logger } from "../../lib/log.js";

function session(overrides: Partial<CliSessionRow> = {}): CliSessionRow {
  return {
    id: "session-12345678",
    provider: "claude",
    provider_session_id: "provider-session-1",
    cwd: "/repo",
    pid: 123,
    tty: "ttys001",
    terminal_app: "iTerm.app",
    terminal_surface_json: null,
    transcript_path: null,
    phase: "waiting_for_input",
    attention_kind: null,
    latest_summary: null,
    latest_prompt: "next step",
    last_event_name: "Stop",
    last_activity_at: "2026-05-25T00:00:00.000Z",
    started_at: "2026-05-25T00:00:00.000Z",
    ended_at: null,
    hidden_at: null,
    observed_prompt_count: 1,
    transcript_activity_at: null,
    ...overrides,
  };
}

function config(overrides: Partial<CliSessionDashboardUpdaterConfig> = {}): CliSessionDashboardUpdaterConfig {
  return {
    channelId: "channel-1",
    channelName: "miniclaw-cli-sessions",
    updateDebounceMs: 1500,
    dashboardLimit: 8,
    staleActiveMs: 15 * 60_000,
    ...overrides,
  };
}

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function dashboardMessage(id = "dashboard-message-1") {
  return {
    id,
    edit: vi.fn(async () => undefined),
    pin: vi.fn(async () => undefined),
  };
}

function sendableChannel(options: {
  fetchedMessage?: ReturnType<typeof dashboardMessage>;
  fetchError?: Error;
  sentMessage?: ReturnType<typeof dashboardMessage>;
} = {}) {
  const sentMessage = options.sentMessage ?? dashboardMessage("created-message-1");
  return {
    id: "channel-1",
    name: "miniclaw-cli-sessions",
    isSendable: () => true,
    send: vi.fn(async () => sentMessage),
    messages: {
      fetch: vi.fn(async () => {
        if (options.fetchError) throw options.fetchError;
        return options.fetchedMessage ?? dashboardMessage("fetched-message-1");
      }),
    },
  };
}

function clientFor(channel: ReturnType<typeof sendableChannel>): Client {
  return {
    channels: {
      fetch: vi.fn(async () => channel),
    },
    guilds: {
      cache: new Map(),
    },
  } as unknown as Client;
}

const loadState = () => ({
  sessions: [session()],
  pendingApprovals: {},
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CLI session dashboard updater", () => {
  it("creates and pins a dashboard message when no message id is configured", async () => {
    const log = logger();
    const sent = dashboardMessage("created-message-1");
    const channel = sendableChannel({ sentMessage: sent });
    const updater = new CliSessionDashboardUpdater(clientFor(channel), config(), {
      loadState,
      logger: log,
      now: () => new Date("2026-05-25T00:01:00.000Z"),
    });

    await updater.start();

    expect(channel.send).toHaveBeenCalledOnce();
    expect(sent.pin).toHaveBeenCalledWith("MiniClaw CLI session dashboard");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("created CLI session dashboard message created-message-1"));
  });

  it("edits the configured dashboard message when it exists", async () => {
    const existing = dashboardMessage("dashboard-message-1");
    const channel = sendableChannel({ fetchedMessage: existing });
    const updater = new CliSessionDashboardUpdater(clientFor(channel), config({
      messageId: "dashboard-message-1",
    }), { loadState, logger: logger() });

    await updater.start();

    expect(channel.messages.fetch).toHaveBeenCalledWith("dashboard-message-1");
    expect(existing.edit).toHaveBeenCalledOnce();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("creates a replacement message when fetching the configured message fails", async () => {
    const log = logger();
    const sent = dashboardMessage("replacement-message-1");
    const channel = sendableChannel({
      fetchError: new Error("missing"),
      sentMessage: sent,
    });
    const updater = new CliSessionDashboardUpdater(clientFor(channel), config({
      messageId: "missing-message-1",
    }), { loadState, logger: log });

    await updater.start();

    expect(channel.messages.fetch).toHaveBeenCalledWith("missing-message-1");
    expect(channel.send).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to fetch CLI session dashboard message missing-message-1"),
      expect.any(Error),
    );
  });

  it("debounces repeated refresh requests into one edit", async () => {
    vi.useFakeTimers();
    const existing = dashboardMessage("dashboard-message-1");
    const channel = sendableChannel({ fetchedMessage: existing });
    const updater = new CliSessionDashboardUpdater(clientFor(channel), config({
      messageId: "dashboard-message-1",
      updateDebounceMs: 100,
    }), { loadState, logger: logger() });

    await updater.start();
    existing.edit.mockClear();

    updater.scheduleRefresh();
    updater.scheduleRefresh();
    updater.scheduleRefresh();

    await vi.advanceTimersByTimeAsync(99);
    expect(existing.edit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(existing.edit).toHaveBeenCalledOnce();
  });
});

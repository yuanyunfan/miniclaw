import { describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { normalizeDiscordChannelName, resolveSendableChannel } from "../channel-resolver.js";

function sendableChannel(name = "miniclaw-auto-improve") {
  return {
    id: "channel-1",
    name,
    isSendable: () => true,
    send: vi.fn(),
  };
}

describe("Discord channel resolver", () => {
  it("normalizes channel names with optional # prefix", () => {
    expect(normalizeDiscordChannelName(" #MiniClaw-Auto-Improve ")).toBe("miniclaw-auto-improve");
  });

  it("resolves a sendable channel by id", async () => {
    const channel = sendableChannel();
    const client = {
      channels: {
        fetch: vi.fn(async () => channel),
      },
      guilds: {
        cache: new Map(),
      },
    } as unknown as Client;

    await expect(resolveSendableChannel(client, { id: "channel-1", purpose: "test" })).resolves.toBe(channel);
  });

  it("resolves a sendable channel by name inside the configured guild", async () => {
    const channel = sendableChannel("miniclaw-auto-improve");
    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async () => new Map([["channel-1", channel]])),
        cache: new Map(),
      },
    };
    const client = {
      channels: {
        fetch: vi.fn(),
      },
      guilds: {
        fetch: vi.fn(async () => guild),
        cache: new Map(),
      },
    } as unknown as Client;

    await expect(resolveSendableChannel(client, {
      name: "#miniclaw-auto-improve",
      guildId: "guild-1",
      purpose: "doctor summary",
    })).resolves.toBe(channel);
  });

  it("falls back from id to name when the id target is unavailable", async () => {
    const channel = sendableChannel("miniclaw-auto-improve");
    const guild = {
      id: "guild-1",
      channels: {
        fetch: vi.fn(async () => new Map([["channel-2", channel]])),
        cache: new Map(),
      },
    };
    const client = {
      channels: {
        fetch: vi.fn(async () => null),
      },
      guilds: {
        fetch: vi.fn(async () => guild),
        cache: new Map(),
      },
    } as unknown as Client;

    await expect(resolveSendableChannel(client, {
      id: "old-channel",
      name: "miniclaw-auto-improve",
      guildId: "guild-1",
      purpose: "doctor summary",
    })).resolves.toBe(channel);
  });
});

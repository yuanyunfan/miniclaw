import type { Client, Guild, GuildBasedChannel, SendableChannels } from "discord.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("discord-channel");

export interface SendableChannelTarget {
  id?: string;
  name?: string;
  guildId?: string;
  purpose?: string;
}

export function normalizeDiscordChannelName(name: string): string {
  return name.trim().replace(/^#+/, "").toLowerCase();
}

function asSendableChannel(channel: unknown): SendableChannels | null {
  if (!channel || typeof channel !== "object") return null;
  if (!("isSendable" in channel) || typeof channel.isSendable !== "function") return null;
  return channel.isSendable() ? (channel as SendableChannels) : null;
}

async function fetchSendableChannelById(client: Client, channelId: string, purpose: string): Promise<SendableChannels | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    const sendable = asSendableChannel(channel);
    if (sendable) return sendable;
    log.warn(`${purpose} channel ${channelId} is not sendable`);
  } catch (err) {
    log.error(`failed to fetch ${purpose} channel ${channelId}:`, err);
  }
  return null;
}

async function fetchGuild(client: Client, guildId: string, purpose: string): Promise<Guild | null> {
  try {
    return await client.guilds.fetch(guildId);
  } catch (err) {
    log.error(`failed to fetch ${purpose} guild ${guildId}:`, err);
    return null;
  }
}

async function fetchGuildChannels(guild: Guild, purpose: string): Promise<Iterable<GuildBasedChannel | null>> {
  try {
    return (await guild.channels.fetch()).values();
  } catch (err) {
    log.error(`failed to fetch ${purpose} channels for guild ${guild.id}; falling back to cache:`, err);
    return guild.channels.cache.values();
  }
}

async function findSendableChannelByName(
  client: Client,
  channelName: string,
  guildId: string | undefined,
  purpose: string
): Promise<SendableChannels | null> {
  const normalized = normalizeDiscordChannelName(channelName);
  if (!normalized) return null;

  const guild = guildId ? await fetchGuild(client, guildId, purpose) : null;
  const guilds = guildId ? (guild ? [guild] : []) : [...client.guilds.cache.values()];

  for (const guild of guilds) {
    if (!guild) continue;
    const channels = await fetchGuildChannels(guild, purpose);
    for (const channel of channels) {
      if (!channel || normalizeDiscordChannelName(channel.name) !== normalized) continue;
      const sendable = asSendableChannel(channel);
      if (sendable) return sendable;
      log.warn(`${purpose} channel #${normalized} exists in guild ${guild.id} but is not sendable`);
      return null;
    }
  }

  const scope = guildId ? `guild ${guildId}` : "cached guilds";
  log.warn(`could not find ${purpose} channel #${normalized} in ${scope}`);
  return null;
}

export async function resolveSendableChannel(client: Client, target: SendableChannelTarget): Promise<SendableChannels | null> {
  const purpose = target.purpose ?? "Discord";
  if (target.id) {
    const channel = await fetchSendableChannelById(client, target.id, purpose);
    if (channel) return channel;
  }
  if (target.name) {
    return findSendableChannelByName(client, target.name, target.guildId, purpose);
  }
  log.warn(`${purpose} channel target is not configured`);
  return null;
}

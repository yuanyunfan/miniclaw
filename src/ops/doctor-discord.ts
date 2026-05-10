import type { Client, SendableChannels } from "discord.js";
import { config } from "../config.js";
import { resolveSendableChannel } from "../discord/channel-resolver.js";

export function doctorSummaryChannelEventTarget(): Record<string, string> {
  return {
    ...(config.doctor.summaryChannelId ? { channel_id: config.doctor.summaryChannelId } : {}),
    ...(config.doctor.summaryChannelName ? { channel_name: config.doctor.summaryChannelName } : {}),
  };
}

export async function resolveDoctorSummaryChannel(client: Client): Promise<SendableChannels | null> {
  return resolveSendableChannel(client, {
    id: config.doctor.summaryChannelId,
    name: config.doctor.summaryChannelName,
    guildId: config.discord.guildId,
    purpose: "doctor summary",
  });
}

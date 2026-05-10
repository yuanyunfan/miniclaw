import "../proxy.js";
import { Client, GatewayIntentBits } from "discord.js";

export function createCronRunnerClient(): Client {
  // Cron CLI runners must not use createBot(): the full bot runs startup
  // recovery and can misclassify live daemon tasks as stale interrupted tasks.
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

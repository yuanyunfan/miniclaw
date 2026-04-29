import { config } from "./config.js";
import { initDb } from "./store/db.js";
import { registerCommands } from "./commands/register.js";
import { createBot } from "./bot.js";
import { startScheduler, stopScheduler } from "./cron/scheduler.js";
import { Events } from "discord.js";

let bot: ReturnType<typeof createBot> | null = null;

async function main(): Promise<void> {
  console.log("[MiniClaw] Starting...");
  const budget = config.defaultBudgetUsd === undefined ? "unlimited" : `$${config.defaultBudgetUsd}`;
  const turns = config.defaultMaxTurns === undefined ? "unlimited" : String(config.defaultMaxTurns);
  console.log(`[MiniClaw] config: model=${config.model} budget=${budget} maxTurns=${turns} maxConcurrent=${config.maxConcurrentTasks}`);

  initDb();
  console.log("[MiniClaw] Database initialized");

  await registerCommands();

  bot = createBot();
  bot.once(Events.ClientReady, (client) => {
    startScheduler(client);
  });
  await bot.login(config.discord.token);

  const shutdown = () => {
    console.log("\n[MiniClaw] Shutting down...");
    stopScheduler();
    bot?.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[MiniClaw] Fatal error:", err);
  bot?.destroy();
  process.exit(1);
});

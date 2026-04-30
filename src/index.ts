import { config } from "./config.js";
import { initDb } from "./store/db.js";
import { registerCommands } from "./commands/register.js";
import { createBot } from "./bot.js";
import { startScheduler, stopScheduler } from "./cron/scheduler.js";
import { createLogger } from "./lib/log.js";
import { Events } from "discord.js";

const log = createLogger("main");
let bot: ReturnType<typeof createBot> | null = null;

async function main(): Promise<void> {
  log.info("Starting...");
  const budget = config.defaultBudgetUsd === undefined ? "unlimited" : `$${config.defaultBudgetUsd}`;
  const turns = config.defaultMaxTurns === undefined ? "unlimited" : String(config.defaultMaxTurns);
  log.info(
    `config: provider=${config.agentProvider} model=${config.model} ` +
    `budget=${budget} maxTurns=${turns} maxConcurrent=${config.maxConcurrentTasks}`
  );

  initDb();
  log.info("Database initialized");

  await registerCommands();

  bot = createBot();
  bot.once(Events.ClientReady, (client) => {
    startScheduler(client);
  });
  await bot.login(config.discord.token);

  const shutdown = () => {
    log.info("Shutting down...");
    stopScheduler();
    bot?.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("Fatal error:", err);
  bot?.destroy();
  process.exit(1);
});

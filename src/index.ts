import { config } from "./config.js";
import { initDb } from "./store/db.js";
import { registerCommands } from "./commands/register.js";
import { createBot } from "./bot.js";

let bot: ReturnType<typeof createBot> | null = null;

async function main(): Promise<void> {
  console.log("[MiniClaw] Starting...");

  initDb();
  console.log("[MiniClaw] Database initialized");

  await registerCommands();

  bot = createBot();
  await bot.login(config.discord.token);

  const shutdown = () => {
    console.log("\n[MiniClaw] Shutting down...");
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

import { config } from "./config.js";
import { initDb } from "./store/db.js";
import { registerCommands } from "./commands/register.js";
import { createBot } from "./bot.js";

async function main(): Promise<void> {
  console.log("[MiniClaw] Starting...");

  initDb();
  console.log("[MiniClaw] Database initialized");

  await registerCommands();

  const bot = createBot();
  await bot.login(config.discord.token);

  process.on("SIGINT", () => {
    console.log("\n[MiniClaw] Shutting down...");
    bot.destroy();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n[MiniClaw] Shutting down...");
    bot.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[MiniClaw] Fatal error:", err);
  process.exit(1);
});

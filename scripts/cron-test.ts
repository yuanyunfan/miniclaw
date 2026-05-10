#!/usr/bin/env tsx
// 立刻试跑某个 cron job（不影响调度）
// 用法: pnpm cron:test <job-name>
import { config } from "../src/config.js";
import { initDb } from "../src/store/db.js";
import { createCronRunnerClient } from "../src/discord/cron-client.js";
import { Events } from "discord.js";
import { runJobNow } from "../src/cron/scheduler.js";

const name = process.argv[2];
if (!name) {
  console.error("usage: pnpm cron:test <job-name>");
  process.exit(2);
}

initDb();
const bot = createCronRunnerClient();

bot.once(Events.ClientReady, async (client) => {
  console.log(`\n🔧 立刻触发 cron job: ${name}\n`);
  try {
    await runJobNow(name, client);
    console.log(`\n✅ done`);
  } catch (err) {
    console.error(`\n❌ failed:`, err);
    process.exit(1);
  } finally {
    bot.destroy();
    process.exit(0);
  }
});

await bot.login(config.discord.token);

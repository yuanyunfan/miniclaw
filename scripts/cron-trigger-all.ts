#!/usr/bin/env tsx
// 串行触发所有 enabled 的 cron job，验证迁移正确
// 用法: pnpm tsx scripts/cron-trigger-all.ts
import { config } from "../src/config.js";
import { initDb } from "../src/store/db.js";
import { createCronRunnerClient } from "../src/discord/cron-client.js";
import { Events } from "discord.js";
import { runJobNow } from "../src/cron/scheduler.js";
import { loadCronJobs } from "../src/cron/loader.js";

initDb();
const bot = createCronRunnerClient();

bot.once(Events.ClientReady, async (client) => {
  const { jobs } = loadCronJobs();
  const enabled = jobs.filter((j) => j.enabled);
  console.log(`\n🚀 串行触发 ${enabled.length} 个 enabled cron job\n`);

  let ok = 0;
  let failed = 0;

  for (const job of enabled) {
    const start = Date.now();
    process.stdout.write(`  [${(ok + failed + 1).toString().padStart(2)}/${enabled.length}] ${job.name.padEnd(30)} ... `);
    try {
      await runJobNow(job.name, client);
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`✅ ${dur}s`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ ${msg.slice(0, 60)}`);
      failed++;
    }
  }

  console.log(`\n📊 总结: ${ok} ✅ / ${failed} ❌`);
  bot.destroy();
  process.exit(failed > 0 ? 1 : 0);
});

await bot.login(config.discord.token);

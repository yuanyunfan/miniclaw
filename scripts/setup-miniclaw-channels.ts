#!/usr/bin/env tsx
// 程序化在 MiniClaw Hub 创建 hermes 同款频道结构
// 用法: pnpm tsx scripts/setup-miniclaw-channels.ts
import { Client, GatewayIntentBits, ChannelType, type Guild } from "discord.js";
import { config } from "../src/config.js";
import { writeFileSync } from "node:fs";

const GUILD_ID = "1497872460232654940"; // MiniClaw Hub

const STRUCTURE = [
  {
    category: "🤖 AI",
    channels: ["daily-ai-news", "daily-ai-frontier", "daily-tech-radar", "daily-github-trending", "daily-app-trending"],
  },
  {
    category: "👤 PERSONAL",
    channels: ["daily-token-dashboard"],
  },
  {
    category: "💹 STOCK",
    channels: ["daily-stock-market"],
  },
  {
    category: "📰 NEWS",
    channels: ["news-domestic", "news-international", "trending", "tldr", "monitor-github-repo"],
  },
] as const;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function ensureCategory(guild: Guild, name: string): Promise<string> {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name
  );
  if (existing) {
    console.log(`  [skip] category 已存在: ${name} (${existing.id})`);
    return existing.id;
  }
  const created = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  console.log(`  [new ] category: ${name} (${created.id})`);
  return created.id;
}

async function ensureTextChannel(guild: Guild, name: string, parentId: string): Promise<string> {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === name
  );
  if (existing) {
    if (existing.parentId !== parentId) {
      await existing.setParent(parentId);
      console.log(`  [move] ${name} → 新分类`);
    } else {
      console.log(`  [skip] channel 已存在: #${name} (${existing.id})`);
    }
    return existing.id;
  }
  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId,
  });
  console.log(`  [new ] channel: #${name} (${created.id})`);
  return created.id;
}

client.once("ready", async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const guild = await c.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  console.log(`Setup MiniClaw Hub (${guild.name})...`);

  const channelMap: Record<string, string> = {};

  for (const group of STRUCTURE) {
    console.log(`\n[${group.category}]`);
    const categoryId = await ensureCategory(guild, group.category);
    for (const chName of group.channels) {
      const id = await ensureTextChannel(guild, chName, categoryId);
      channelMap[chName] = id;
    }
  }

  const out = "/Users/yuan/ProjectRepo/miniclaw/scripts/.channel-map.json";
  writeFileSync(out, JSON.stringify(channelMap, null, 2));
  console.log(`\n✅ 完成。channel 映射已写入: ${out}`);
  console.log(JSON.stringify(channelMap, null, 2));

  client.destroy();
  process.exit(0);
});

await client.login(config.discord.token);

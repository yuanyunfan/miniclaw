#!/usr/bin/env tsx
// 程序化在 MiniClaw Hub 创建 hermes 同款频道结构
// 用法: pnpm tsx scripts/setup-miniclaw-channels.ts
//
// channel ID 映射写入 ~/.miniclaw/channel-map.json（用户级配置，不进 git repo）
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, type Guild, type OverwriteResolvable } from "discord.js";
import { config } from "../src/config.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const GUILD_ID = process.env.MINICLAW_GUILD_ID ?? config.discord.guildId;
type ChannelSpec = string | { name: string; private?: boolean };

const STRUCTURE = [
  {
    category: "🤖 AI",
    channels: [
      "daily-ai-news",
      "daily-ai-frontier",
      "daily-tech-radar",
      "daily-github-trending",
      "daily-app-trending",
      { name: "miniclaw-third-part", private: true },
    ],
  },
  {
    category: "👤 PERSONAL",
    channels: ["daily-token-dashboard"],
  },
  {
    category: "💹 STOCK",
    channels: ["daily-us-stock", "daily-cn-stock", "daily-watchlist-stock", { name: "daily-stock-summary", private: true }],
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

function channelName(spec: ChannelSpec): string {
  return typeof spec === "string" ? spec : spec.name;
}

function privateOverwrites(guild: Guild): OverwriteResolvable[] {
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
  ];
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: config.allowedUserId, allow },
    { id: client.user!.id, allow },
  ];
}

async function applyPrivateOverwrites(guild: Guild, channelId: string): Promise<void> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  for (const overwrite of privateOverwrites(guild)) {
    await channel.permissionOverwrites.edit(overwrite.id, {
      ViewChannel: overwrite.id === guild.roles.everyone.id ? false : true,
      SendMessages: overwrite.id === guild.roles.everyone.id ? null : true,
      ReadMessageHistory: overwrite.id === guild.roles.everyone.id ? null : true,
      EmbedLinks: overwrite.id === guild.roles.everyone.id ? null : true,
      AttachFiles: overwrite.id === guild.roles.everyone.id ? null : true,
    });
  }
}

async function ensureTextChannel(guild: Guild, spec: ChannelSpec, parentId: string): Promise<string> {
  const name = channelName(spec);
  const isPrivate = typeof spec !== "string" && spec.private === true;
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
    if (isPrivate) {
      await applyPrivateOverwrites(guild, existing.id);
      console.log(`  [lock] private channel: #${name}`);
    }
    return existing.id;
  }
  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites: isPrivate ? privateOverwrites(guild) : undefined,
  });
  console.log(`  [new ] channel: #${name} (${created.id})`);
  return created.id;
}

function readExistingChannelMap(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [name, id] of Object.entries(parsed)) {
      if (typeof name === "string" && typeof id === "string" && /^\d{15,25}$/.test(id)) {
        out[name] = id;
      }
    }
    return out;
  } catch {
    return {};
  }
}

client.once("ready", async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const guild = await c.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  console.log(`Setup MiniClaw Hub (${guild.name})...`);

  const out = process.env.MINICLAW_CHANNEL_MAP ?? join(homedir(), ".miniclaw/channel-map.json");
  const channelMap: Record<string, string> = readExistingChannelMap(out);

  for (const group of STRUCTURE) {
    console.log(`\n[${group.category}]`);
    const categoryId = await ensureCategory(guild, group.category);
    for (const ch of group.channels) {
      const id = await ensureTextChannel(guild, ch, categoryId);
      channelMap[channelName(ch)] = id;
    }
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(channelMap, null, 2));
  console.log(`\n✅ 完成。channel 映射已写入: ${out}`);
  console.log(JSON.stringify(channelMap, null, 2));

  client.destroy();
  process.exit(0);
});

await client.login(config.discord.token);

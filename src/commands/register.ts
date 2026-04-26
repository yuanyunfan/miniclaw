import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "../config.js";

const commands = [
  new SlashCommandBuilder()
    .setName("task")
    .setDescription("委派任务给 Claude Code")
    .addStringOption((opt) =>
      opt.setName("description").setDescription("任务描述").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("cwd").setDescription("工作目录（默认 ~/Code）").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("查看当前活跃任务"),

  new SlashCommandBuilder()
    .setName("cancel")
    .setDescription("取消正在运行的任务")
    .addStringOption((opt) =>
      opt.setName("task_id").setDescription("任务 ID（前 8 位即可）").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("继续之前的任务")
    .addStringOption((opt) =>
      opt.setName("task_id").setDescription("任务 ID").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("followup").setDescription("后续指令").setRequired(true)
    ),
];

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  const body = commands.map((c) => c.toJSON());
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body }
  );
  console.log(`[MiniClaw] Registered ${body.length} slash commands`);
}

if (process.argv[1]?.endsWith("register.ts") || process.argv[1]?.endsWith("register.js")) {
  registerCommands().catch(console.error);
}

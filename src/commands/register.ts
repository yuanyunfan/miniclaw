import "../proxy.js";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "../config.js";
import { createLogger } from "../lib/log.js";

const log = createLogger("register");

const commands = [
  new SlashCommandBuilder()
    .setName("task")
    .setDescription("委派任务给当前 coding agent")
    .addStringOption((opt) =>
      opt.setName("description").setDescription("任务描述").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("cwd").setDescription("工作目录（默认 ~/Code）").setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt.setName("file1").setDescription("附件 1（可选）").setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt.setName("file2").setDescription("附件 2（可选）").setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt.setName("file3").setDescription("附件 3（可选）").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("查看当前活跃任务"),

  new SlashCommandBuilder()
    .setName("health")
    .setDescription("查看 MiniClaw 运行健康状态"),

  new SlashCommandBuilder()
    .setName("doctor")
    .setDescription("只读诊断 MiniClaw task / cron / 运行状态")
    .addStringOption((opt) =>
      opt.setName("task_id").setDescription("任务 ID 前缀（可选）").setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName("cron").setDescription("cron job 名称（可选）").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("incidents")
    .setDescription("查看 Auto Doctor open incidents")
    .addIntegerOption((opt) =>
      opt.setName("limit").setDescription("最多显示多少条（默认 10，最多 25）").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("incident")
    .setDescription("查看或管理单个 Auto Doctor incident")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("查看 incident 详情、事件和 repair 历史")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("incident id 或前缀").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("resolve")
        .setDescription("把 incident 标记为 resolved")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("incident id 或前缀").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("处理说明（可选）").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("ignore")
        .setDescription("把 incident 标记为 ignored")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("incident id 或前缀").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("忽略原因（可选）").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("retry-repair")
        .setDescription("重新开放 incident，让 hourly Auto Doctor 按 policy 再尝试修复")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("incident id 或前缀").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("ship-preview")
        .setDescription("预览 pushed repair branch 的 guarded ship 命令")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("incident id 或前缀").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("approve-ship")
        .setDescription("显式批准 guarded ship 更新 main，可选请求 safe restart")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("incident id 或前缀").setRequired(true)
        )
        .addBooleanOption((opt) =>
          opt.setName("restart").setDescription("ship 后是否请求 safe restart（不 force）").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("request-restart")
        .setDescription("对已准备 ship 的 incident 请求 guarded ship + safe restart")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("incident id 或前缀").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("agent-config")
    .setDescription("查看当前 agent settings / MCP / skills 继承摘要"),

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

  new SlashCommandBuilder()
    .setName("remember")
    .setDescription("让 bot 记住一条信息")
    .addStringOption((opt) =>
      opt.setName("content").setDescription("要记住的内容").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("记忆类型")
        .setRequired(false)
        .addChoices(
          { name: "用户信息", value: "user" },
          { name: "反馈偏好", value: "feedback" },
          { name: "项目信息", value: "project" },
          { name: "参考资料", value: "reference" },
        )
    )
    .addStringOption((opt) =>
      opt.setName("name").setDescription("记忆名称（可选，默认自动生成）").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("forget")
    .setDescription("删除一条记忆")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("记忆 ID（4 字符 hex，例如 7f3a）").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("memories")
    .setDescription("查看所有记忆")
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("按类型筛选")
        .setRequired(false)
        .addChoices(
          { name: "用户信息", value: "user" },
          { name: "反馈偏好", value: "feedback" },
          { name: "项目信息", value: "project" },
          { name: "参考资料", value: "reference" },
        )
    ),
];

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  const body = commands.map((c) => c.toJSON());
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body }
  );
  log.info(`Registered ${body.length} slash commands`);
}

if (process.argv[1]?.endsWith("register.ts") || process.argv[1]?.endsWith("register.js")) {
  registerCommands().catch((err) => log.error("Register failed:", err));
}

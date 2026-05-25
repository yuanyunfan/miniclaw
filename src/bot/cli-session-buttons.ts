import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from "discord.js";
import { config } from "../config.js";
import {
  buildCliSessionContinueModalId,
  buildCliSessionDetailEmbed,
  parseCliSessionCustomId,
} from "../discord/cli-session-dashboard.js";
import { getCliSession, hideCliSession } from "../store/db.js";

function buildContinueModal(sessionId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("followup")
    .setLabel("Follow-up instruction")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1800);
  return new ModalBuilder()
    .setCustomId(buildCliSessionContinueModalId(sessionId))
    .setTitle("Continue CLI Session")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function handleCliSessionButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseCliSessionCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== config.allowedUserId) {
    await interaction.reply({ content: "No permission.", ephemeral: true });
    return true;
  }

  const session = getCliSession(parsed.sessionId);
  if (!session) {
    await interaction.reply({ content: "CLI session not found.", ephemeral: true });
    return true;
  }

  if (parsed.action === "details") {
    await interaction.reply({
      embeds: [buildCliSessionDetailEmbed(session)],
      ephemeral: true,
    });
    return true;
  }

  if (parsed.action === "continue") {
    if (session.phase !== "waiting_for_input") {
      await interaction.reply({
        content: "This session is not idle. MiniClaw will not start a same-provider continuation while the observed CLI session is still active.",
        ephemeral: true,
      });
      return true;
    }
    await interaction.showModal(buildContinueModal(session.id));
    return true;
  }

  if (parsed.action === "hide") {
    const changed = hideCliSession(session.id);
    await interaction.reply({
      content: changed
        ? `Hidden CLI session ${session.id.slice(0, 8)}.`
        : `CLI session ${session.id.slice(0, 8)} was already hidden.`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

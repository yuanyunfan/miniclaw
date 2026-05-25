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
import { getCliSession, getCliSessionApproval, hideCliSession } from "../store/db.js";
import { hookdApprovalRegistry } from "../hookd/approvals.js";

let dashboardRefreshCallback: (() => void) | null = null;

export function setCliSessionDashboardRefreshCallback(callback: (() => void) | null): void {
  dashboardRefreshCallback = callback;
}

export function requestCliSessionDashboardRefresh(): void {
  dashboardRefreshCallback?.();
}

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

  if ("approvalId" in parsed) {
    const approval = getCliSessionApproval(parsed.approvalId);
    if (!approval) {
      await interaction.reply({ content: "Approval request not found.", ephemeral: true });
      return true;
    }
    if (approval.status !== "pending") {
      await interaction.reply({
        content: `Approval request ${approval.id.slice(0, 8)} is already ${approval.status}.`,
        ephemeral: true,
      });
      return true;
    }
    const result = hookdApprovalRegistry.resolve(
      approval.id,
      parsed.action === "approve" ? "allow" : "deny",
      interaction.user.id,
      parsed.action === "approve" ? undefined : "Denied from Discord",
    );
    await interaction.reply({
      content: result
        ? `${parsed.action === "approve" ? "Approved" : "Denied"} CLI permission request ${approval.id.slice(0, 8)}.`
        : `Approval request ${approval.id.slice(0, 8)} could not be resolved.`,
      ephemeral: true,
    });
    if (result) requestCliSessionDashboardRefresh();
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
    if (changed) requestCliSessionDashboardRefresh();
    return true;
  }

  return false;
}

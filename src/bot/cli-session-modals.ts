import type { ModalSubmitInteraction } from "discord.js";
import { config } from "../config.js";
import { parseCliSessionContinueModalId } from "../discord/cli-session-dashboard.js";
import { sendCliSessionLiveTerminalInput } from "../hookd/live-terminal-input.js";
import { getCliSession, markCliSessionEnded } from "../store/db.js";
import { createLogger } from "../lib/log.js";
import { requestCliSessionDashboardRefresh } from "./cli-session-buttons.js";

const log = createLogger("cli-session-modal");

export async function handleCliSessionModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const parsed = parseCliSessionContinueModalId(interaction.customId);
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
  if (!config.hookd.liveTerminalContinueEnabled) {
    await interaction.reply({ content: "Live terminal Continue is disabled.", ephemeral: true });
    return true;
  }

  const followup = interaction.fields.getTextInputValue("followup").trim();
  if (!followup) {
    await interaction.reply({ content: "Follow-up instruction is empty.", ephemeral: true });
    return true;
  }

  const result = await sendCliSessionLiveTerminalInput(session, followup);
  if (!result.ok) {
    if (result.code === "pid_dead") {
      markCliSessionEnded(session.id, "pid_dead");
      requestCliSessionDashboardRefresh();
    }
    await interaction.reply({
      content: `Could not send follow-up to the live iTerm2 session: ${result.message}`,
      ephemeral: true,
    });
    return true;
  }

  await interaction.reply({
    content: `Sent follow-up to iTerm2 session ${result.target.id.slice(0, 8)} for ${session.provider} CLI session ${session.id.slice(0, 8)}. Watch the original terminal for output.`,
    ephemeral: true,
  });
  requestCliSessionDashboardRefresh();
  log.info(`sent CLI session ${session.id.slice(0, 8)} follow-up to iTerm2 target ${result.target.id.slice(0, 8)}`);
  return true;
}

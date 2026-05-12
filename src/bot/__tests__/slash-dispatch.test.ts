import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchSlashCommand,
  type SlashCommandDispatchDependencies,
} from "../slash-dispatch.js";

function fakeSlashCommand(
  commandName: string,
  overrides: { deferred?: boolean; replied?: boolean } = {}
): {
  cmd: ChatInputCommandInteraction;
  reply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  const editReply = vi.fn(async (_payload: unknown) => undefined);
  return {
    cmd: {
      commandName,
      deferred: overrides.deferred ?? false,
      replied: overrides.replied ?? false,
      reply,
      editReply,
    } as unknown as ChatInputCommandInteraction,
    reply,
    editReply,
  };
}

function dependencies(
  handlers: SlashCommandDispatchDependencies["handlers"],
  logError = vi.fn()
): SlashCommandDispatchDependencies {
  return { handlers, logError };
}

describe("dispatchSlashCommand", () => {
  it("dispatches a known slash command to the matching handler", async () => {
    const { cmd, reply } = fakeSlashCommand("task");
    const handler = vi.fn(async (_interaction: ChatInputCommandInteraction) => undefined);

    await dispatchSlashCommand(cmd, dependencies({ task: handler }));

    expect(handler).toHaveBeenCalledWith(cmd);
    expect(reply).not.toHaveBeenCalled();
  });

  it("replies with unknown command when there is no matching handler", async () => {
    const { cmd, reply } = fakeSlashCommand("missing");

    await dispatchSlashCommand(cmd, dependencies({}));

    expect(reply).toHaveBeenCalledWith({ content: "未知命令", ephemeral: true });
  });

  it("replies with a generic error when a handler fails before acknowledgement", async () => {
    const { cmd, reply, editReply } = fakeSlashCommand("task");
    const logError = vi.fn();
    const handler = vi.fn(async (_interaction: ChatInputCommandInteraction) => {
      throw new Error("boom");
    });

    await dispatchSlashCommand(cmd, dependencies({ task: handler }, logError));

    expect(logError).toHaveBeenCalledWith("Command error:", expect.any(Error));
    expect(reply).toHaveBeenCalledWith({ content: "❌ 命令执行出错", ephemeral: true });
    expect(editReply).not.toHaveBeenCalled();
  });

  it("edits the existing reply when a handler fails after defer", async () => {
    const { cmd, reply, editReply } = fakeSlashCommand("task", { deferred: true });
    const handler = vi.fn(async (_interaction: ChatInputCommandInteraction) => {
      throw new Error("boom");
    });

    await dispatchSlashCommand(cmd, dependencies({ task: handler }));

    expect(editReply).toHaveBeenCalledWith("❌ 命令执行出错");
    expect(reply).not.toHaveBeenCalled();
  });
});

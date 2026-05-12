import type { ButtonInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchButtonInteraction,
  type ButtonDispatchDependencies,
} from "../button-dispatch.js";

function fakeButtonInteraction(overrides: { deferred?: boolean; replied?: boolean } = {}): {
  interaction: ButtonInteraction;
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  const followUp = vi.fn(async (_payload: unknown) => undefined);
  return {
    interaction: {
      deferred: overrides.deferred ?? false,
      replied: overrides.replied ?? false,
      reply,
      followUp,
    } as unknown as ButtonInteraction,
    reply,
    followUp,
  };
}

function dependencies(
  overrides: Partial<ButtonDispatchDependencies> = {}
): ButtonDispatchDependencies {
  return {
    handleCronRetryButton: vi.fn(async (_interaction: ButtonInteraction) => false),
    handleSmartRouterButton: vi.fn(async (_interaction: ButtonInteraction) => false),
    logError: vi.fn(),
    ...overrides,
  };
}

describe("dispatchButtonInteraction", () => {
  it("handles cron retry buttons before smart router buttons", async () => {
    const { interaction } = fakeButtonInteraction();
    const deps = dependencies({
      handleCronRetryButton: vi.fn(async (_interaction: ButtonInteraction) => true),
      handleSmartRouterButton: vi.fn(async (_interaction: ButtonInteraction) => true),
    });

    await expect(dispatchButtonInteraction(interaction, deps)).resolves.toBe(true);

    expect(deps.handleCronRetryButton).toHaveBeenCalledWith(interaction);
    expect(deps.handleSmartRouterButton).not.toHaveBeenCalled();
  });

  it("falls through to smart router buttons when cron retry does not claim the interaction", async () => {
    const { interaction } = fakeButtonInteraction();
    const deps = dependencies({
      handleSmartRouterButton: vi.fn(async (_interaction: ButtonInteraction) => true),
    });

    await expect(dispatchButtonInteraction(interaction, deps)).resolves.toBe(true);

    expect(deps.handleCronRetryButton).toHaveBeenCalledWith(interaction);
    expect(deps.handleSmartRouterButton).toHaveBeenCalledWith(interaction);
  });

  it("returns false when no button handler claims the interaction", async () => {
    const { interaction } = fakeButtonInteraction();
    const deps = dependencies();

    await expect(dispatchButtonInteraction(interaction, deps)).resolves.toBe(false);
  });

  it("replies with a generic error when button dispatch fails before acknowledgement", async () => {
    const { interaction, reply, followUp } = fakeButtonInteraction();
    const deps = dependencies({
      handleCronRetryButton: vi.fn(async (_interaction: ButtonInteraction) => {
        throw new Error("boom");
      }),
    });

    await expect(dispatchButtonInteraction(interaction, deps)).resolves.toBe(true);

    expect(deps.logError).toHaveBeenCalledWith("Button interaction error:", expect.any(Error));
    expect(reply).toHaveBeenCalledWith({ content: "❌ 按钮处理出错", ephemeral: true });
    expect(followUp).not.toHaveBeenCalled();
  });

  it("uses followUp for errors after the button interaction was acknowledged", async () => {
    const { interaction, reply, followUp } = fakeButtonInteraction({ deferred: true });
    const deps = dependencies({
      handleCronRetryButton: vi.fn(async (_interaction: ButtonInteraction) => {
        throw new Error("boom");
      }),
    });

    await expect(dispatchButtonInteraction(interaction, deps)).resolves.toBe(true);

    expect(followUp).toHaveBeenCalledWith({ content: "❌ 按钮处理出错", ephemeral: true });
    expect(reply).not.toHaveBeenCalled();
  });
});

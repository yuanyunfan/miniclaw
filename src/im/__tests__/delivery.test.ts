import { describe, expect, it } from "vitest";
import { resolveDeliveryTargets, sendTextToTargets } from "../delivery.js";
import type { IMTransport } from "../contracts.js";

function recordingTransport(id: "discord" | "feishu", sent: string[]): IMTransport {
  return {
    id,
    kind: "im_transport",
    capabilities: {
      richEmbeds: id === "discord",
      markdown: id,
      editMessage: id === "discord",
      threads: id === "discord",
      files: id === "discord",
      buttons: id === "discord",
      slashCommands: id === "discord",
      mentions: id === "discord",
    },
    async send(input) {
      sent.push(`${id}:${input.target.target}:${input.content}`);
      return {
        transport: id,
        target: input.target.target,
        messageId: `${id}-message`,
      };
    },
  };
}

describe("IM delivery", () => {
  it("resolves primary Discord plus extra route targets without duplicates", () => {
    const targets = resolveDeliveryTargets({
      fallbackDiscordTarget: "1000000000000000000",
      route: "daily",
      routes: {
        daily: {
          targets: [
            { transport: "discord", target: "1000000000000000000" },
            { transport: "feishu", target: "default" },
          ],
        },
      },
    });

    expect(targets).toEqual([
      { transport: "discord", target: "1000000000000000000" },
      { transport: "feishu", target: "default" },
    ]);
  });

  it("can resolve only extra route targets for task fanout", () => {
    const targets = resolveDeliveryTargets({
      fallbackDiscordTarget: "1000000000000000000",
      route: "daily",
      extraOnly: true,
      routes: {
        daily: {
          targets: [
            { transport: "discord", target: "1000000000000000000" },
            { transport: "feishu", target: "default" },
          ],
        },
      },
    });

    expect(targets).toEqual([{ transport: "feishu", target: "default" }]);
  });

  it("sends text through every requested transport", async () => {
    const sent: string[] = [];
    const registry = new Map([
      ["discord", recordingTransport("discord", sent)],
      ["feishu", recordingTransport("feishu", sent)],
    ] as const);

    const results = await sendTextToTargets({
      registry,
      content: "hello",
      targets: [
        { transport: "discord", target: "1000000000000000000" },
        { transport: "feishu", target: "default" },
      ],
    });

    expect(results).toHaveLength(2);
    expect(sent).toEqual([
      "discord:1000000000000000000:hello",
      "feishu:default:hello",
    ]);
  });
});

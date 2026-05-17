import { describe, expect, it } from "vitest";
import { resolveDeliveryTargets, sendTextToTargets } from "../delivery.js";
import type { IMTransport } from "../contracts.js";

interface RecordedSend {
  transport: "discord" | "feishu";
  target: string;
  content: string;
  suppressEmbeds?: boolean;
}

function recordingTransport(id: "discord" | "feishu", sent: RecordedSend[]): IMTransport {
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
      sent.push({
        transport: id,
        target: input.target.target,
        content: input.content,
        suppressEmbeds: input.suppressEmbeds,
      });
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
    const sent: RecordedSend[] = [];
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
      { transport: "discord", target: "1000000000000000000", content: "hello", suppressEmbeds: false },
      { transport: "feishu", target: "default", content: "hello", suppressEmbeds: undefined },
    ]);
  });

  it("defers Discord link previews to a final footer for IM fanout", async () => {
    const sent: RecordedSend[] = [];
    const registry = new Map([
      ["discord", recordingTransport("discord", sent)],
    ] as const);

    await sendTextToTargets({
      registry,
      content: "正文 https://example.com/a 和 [B](https://example.com/b)。",
      targets: [{ transport: "discord", target: "1000000000000000000" }],
    });

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      transport: "discord",
      target: "1000000000000000000",
      suppressEmbeds: true,
    });
    expect(sent[0]?.content).toContain("正文 https://example.com/a");
    expect(sent[1]).toMatchObject({
      transport: "discord",
      target: "1000000000000000000",
      suppressEmbeds: false,
    });
    expect(sent[1]?.content).toContain("链接预览集中区");
    expect(sent[1]?.content).toContain("https://example.com/a");
    expect(sent[1]?.content).toContain("https://example.com/b");
  });
});

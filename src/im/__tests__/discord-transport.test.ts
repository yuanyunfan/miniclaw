import { describe, expect, it } from "vitest";
import { MessageFlags, type Client } from "discord.js";
import { createDiscordTransport } from "../adapters/discord/transport.js";

function fakeClient(sent: unknown[]): Client {
  return {
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async (payload: unknown) => {
          sent.push(payload);
          return { id: "message-1", url: "https://discord.test/message-1" };
        },
      }),
    },
  } as unknown as Client;
}

describe("Discord IM transport", () => {
  it("sends object payloads with mention safety and optional embed suppression", async () => {
    const sent: unknown[] = [];
    const transport = createDiscordTransport(fakeClient(sent));

    await transport.send({
      target: { transport: "discord", target: "1000000000000000000" },
      content: "hello https://example.com/a",
      suppressEmbeds: true,
    });

    expect(sent[0]).toMatchObject({
      content: "hello https://example.com/a",
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressEmbeds,
    });
  });
});

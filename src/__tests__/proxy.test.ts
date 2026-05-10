import { describe, expect, it } from "vitest";
import { __testables } from "../proxy.js";

describe("Discord gateway proxy patch", () => {
  it("bypasses system DNS for the Discord gateway host", async () => {
    const prev = process.env.MINICLAW_DISCORD_GATEWAY_IPS;
    process.env.MINICLAW_DISCORD_GATEWAY_IPS = "203.0.113.10";
    try {
      await new Promise<void>((resolve, reject) => {
        __testables.discordGatewayLookup(
          "gateway.discord.gg",
          { all: true },
          (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>) => {
            if (err) {
              reject(err);
              return;
            }
            expect(address).toEqual([{ address: "203.0.113.10", family: 4 }]);
            resolve();
          },
        );
      });
    } finally {
      if (prev === undefined) delete process.env.MINICLAW_DISCORD_GATEWAY_IPS;
      else process.env.MINICLAW_DISCORD_GATEWAY_IPS = prev;
    }
  });
});

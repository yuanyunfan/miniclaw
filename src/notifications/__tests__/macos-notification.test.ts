import { describe, expect, it } from "vitest";
import { buildDisplayNotificationScript } from "../macos-notification.js";

describe("macOS notification script", () => {
  it("escapes AppleScript string values", () => {
    const script = buildDisplayNotificationScript({
      title: 'MiniClaw "startup"',
      subtitle: "clientReady",
      body: 'bot.login failed: token="secret"',
    });

    expect(script).toContain('with title "MiniClaw \\"startup\\""');
    expect(script).toContain('display notification "bot.login failed: token=\\"secret\\""');
    expect(script).toContain('subtitle "clientReady"');
  });
});

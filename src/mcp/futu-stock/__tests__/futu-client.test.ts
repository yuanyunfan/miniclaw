import { describe, expect, it } from "vitest";
import { parseLastJsonPayload } from "../futu-client.js";

describe("parseLastJsonPayload", () => {
  it("ignores Futu SDK stdout logs after the JSON payload", () => {
    const payload = parseLastJsonPayload<{ ok: boolean; positions: unknown[] }>([
      "2026-05-07 18:52:06,897 | [open_context_base.py:410] New connect ready",
      "{\"ok\":true,\"positions\":[]}",
      "2026-05-07 18:52:08,023 | [open_context_base.py:518] on_disconnect: Disconnected",
    ].join("\n"));

    expect(payload).toEqual({ ok: true, positions: [] });
  });

  it("reports when no JSON payload is present", () => {
    expect(() => parseLastJsonPayload("plain futu log only")).toThrow("did not emit JSON payload");
  });
});

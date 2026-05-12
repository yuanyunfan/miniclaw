import { describe, expect, it } from "vitest";
import type { ModelClient } from "../model-client.js";

describe("runtime contracts", () => {
  it("keeps ModelClient separate from coding-agent task capabilities", async () => {
    const client: ModelClient = {
      id: "router-test",
      kind: "model_client",
      complete: async () => ({ text: "ok" }),
      classify: async (input) => input.parse("true"),
    };

    await expect(client.complete({ prompt: "ping" })).resolves.toEqual({ text: "ok" });
    await expect(client.classify?.({ prompt: "classify", parse: (text) => text === "true" })).resolves.toBe(true);
    expect("capabilities" in client).toBe(false);
    expect("startTask" in client).toBe(false);
  });
});

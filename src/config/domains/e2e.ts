import { tmpdir } from "node:os";
import type { ConfigReader } from "../env.js";

export function buildE2eRuntimeConfig(reader: ConfigReader) {
  return {
    mode: reader.boolValue(["e2e", "mode"], "MINICLAW_E2E_MODE", false),
    senderUserIds: reader.stringArray(["e2e", "sender_user_ids"], "MINICLAW_E2E_SENDER_USER_IDS"),
    disableScheduler: reader.boolValue(["e2e", "disable_scheduler"], "MINICLAW_DISABLE_SCHEDULER", false),
    fakeAgent: reader.boolValue(["e2e", "fake_agent"], "MINICLAW_E2E_FAKE_AGENT", false),
    tempRoot: tmpdir(),
  } as const;
}

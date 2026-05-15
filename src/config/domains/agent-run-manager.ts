import type { ConfigReader } from "../env.js";

export function buildAgentRunManagerRuntimeConfig(reader: ConfigReader) {
  return {
    enabled: reader.boolValue(
      ["agent_run_manager", "enabled"],
      "MINICLAW_AGENT_RUN_MANAGER_ENABLED",
      false
    ),
  } as const;
}

import type { ConfigReader } from "../env.js";
import type { AgentProvider } from "../types.js";

export function buildProviderRuntimeConfig(reader: ConfigReader, agentProvider: AgentProvider) {
  return {
    anthropicApiKey:
      agentProvider === "claude"
        ? reader.requiredString(["anthropic", "api_key"], "ANTHROPIC_API_KEY")
        : reader.optionalString(["anthropic", "api_key"], "ANTHROPIC_API_KEY"),
    anthropicBaseUrl: reader.optionalString(["anthropic", "base_url"], "ANTHROPIC_BASE_URL"),
    openaiApiKey: reader.optionalString(["openai", "api_key"], "OPENAI_API_KEY"),
    openaiBaseUrl: reader.optionalString(["openai", "base_url"], "OPENAI_BASE_URL"),
  } as const;
}

export function applyProviderBaseUrlEnv(
  providerConfig: Pick<ReturnType<typeof buildProviderRuntimeConfig>, "anthropicBaseUrl" | "openaiBaseUrl">,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (providerConfig.anthropicBaseUrl && !env.ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = providerConfig.anthropicBaseUrl;
  }
  if (providerConfig.openaiBaseUrl && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = providerConfig.openaiBaseUrl;
  }
}

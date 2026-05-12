import { loadPrompt } from "./prompts.js";

export function buildSupervisorBlock(subagentNames: string[]): string {
  if (!subagentNames.length) return "";
  return loadPrompt("supervisor", { subagent_names: subagentNames.join(" / ") });
}

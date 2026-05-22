import { loadPrompt } from "../agent/prompts.js";
import type { CronJobTask } from "./types.js";

export interface ResolvedCronOutputContract {
  template: string;
  validator: string;
  renderedTemplate: string;
}

export interface CronTaskOutputValidationResult {
  ok: boolean;
  category: string;
  message: string;
}

export function resolveCronOutputContract(job: CronJobTask): ResolvedCronOutputContract | undefined {
  if (!job.output_contract) return undefined;
  const contract = job.output_contract;
  return {
    template: contract.template,
    validator: contract.validator,
    renderedTemplate: loadPrompt(`templates/cron-output/${contract.template}`, contract.vars ?? {}),
  };
}

export function buildCronOutputContractBlock(contract?: ResolvedCronOutputContract): string {
  if (!contract) return "";
  return [
    `<cron_output_contract template="${contract.template}" validator="${contract.validator}">`,
    "Treat this as the prompt-level output contract for this scheduled cron task.",
    "Format the final task result according to the rendered template below.",
    "Do not mention the contract itself unless the user explicitly asks about formatting.",
    "",
    contract.renderedTemplate.trim(),
    "</cron_output_contract>",
    "",
    "",
  ].join("\n");
}

export function validateCronTaskOutput(
  contract: ResolvedCronOutputContract | undefined,
  output: string,
): CronTaskOutputValidationResult {
  if (!contract || contract.validator === "none") {
    return { ok: true, category: "none", message: "output validation skipped" };
  }
  return {
    ok: false,
    category: "unsupported_output_contract_validator",
    message: `Unsupported cron output validator '${contract.validator}' for ${contract.template}; output length=${output.length}`,
  };
}

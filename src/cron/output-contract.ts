import { renderTemplate } from "./template.js";
import type { CronJobTask } from "./types.js";

export interface ResolvedCronOutputContract {
  validator: string;
  renderedTemplate: string;
}

export interface CronTaskOutputValidationResult {
  ok: boolean;
  category: string;
  message: string;
}

export const CRON_OUTPUT_SURFACE_POLICY = [
  "Output surface policy:",
  "- Use concise Markdown suitable for chat/IM delivery.",
  "- Avoid Markdown pipe tables; use bullets, compact sections, or lists instead.",
  "- Start with the conclusion, then give supporting evidence.",
  "- Return only the final report. Do not explain the output contract.",
].join("\n");

export function resolveCronOutputContract(job: CronJobTask): ResolvedCronOutputContract | undefined {
  if (!job.output_contract) return undefined;
  const contract = job.output_contract;
  return {
    validator: contract.validator,
    renderedTemplate: renderTemplate(contract.template, contract.vars ?? {}),
  };
}

export function buildCronOutputContractBlock(contract?: ResolvedCronOutputContract): string {
  if (!contract) return "";
  return [
    `<cron_output_contract source="cron-yaml" validator="${contract.validator}">`,
    "Treat this as the prompt-level output contract for this scheduled cron task.",
    "Format the final task result according to the rendered template below.",
    "Do not mention the contract itself unless the user explicitly asks about formatting.",
    "",
    CRON_OUTPUT_SURFACE_POLICY,
    "",
    "Job-specific output template:",
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
    message: `Unsupported cron output validator '${contract.validator}'; output length=${output.length}`,
  };
}

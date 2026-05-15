import {
  listActiveFacts,
  listArtifactsForTask,
  listMessagesForTask,
  listRunsForTask,
  type AgentArtifact,
  type AgentMessage,
  type AgentRun,
  type BlackboardFact,
} from "../../store/agent-run-manager.js";
import { redactDiagnosticText, redactDiagnosticValue } from "../../privacy/diagnostic-redaction.js";
import type { ManagedRunVerdict } from "./envelope.js";

export interface FinalSynthesisInput {
  taskId: string;
  verdict: ManagedRunVerdict;
  summary?: string;
  fixList?: string[];
  maxEvidenceItems?: number;
}

const DEFAULT_MAX_EVIDENCE_ITEMS = 8;
const VERIFICATION_PATTERN = /\b(test|tests|tested|verify|verified|verification|lint|typecheck|build|vitest|jest|pytest|pnpm|npm|yarn|passed|quality)\b|验证|测试|通过|构建|检查|质量/i;

function shortId(value: string): string {
  return value.slice(0, 8);
}

function clip(value: string | null | undefined, max = 180): string {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? redactDiagnosticText(trimmed, { maxChars: max }) : "-";
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_EVIDENCE_ITEMS;
  return Math.max(1, Math.floor(value));
}

function roleByRunId(runs: AgentRun[]): Map<string, string> {
  return new Map(runs.map((run) => [run.id, run.role]));
}

function runSummaryLine(run: AgentRun): string {
  const session = run.provider_session_id
    ? ` session=${String(redactDiagnosticValue("session_id", run.provider_session_id, { maxChars: 90 }))}`
    : "";
  const error = run.error_message ? ` error=${clip(run.error_message, 120)}` : "";
  return `- ${run.role}(${shortId(run.id)}): ${run.status}${session}${error}`;
}

function factEvidenceLine(fact: BlackboardFact): string {
  return `- blackboard ${fact.key}: ${clip(fact.content)} confidence=${fact.confidence} source=${shortId(fact.source_message_id)}`;
}

function artifactEvidenceLine(artifact: AgentArtifact, roles: Map<string, string>): string {
  const owner = roles.get(artifact.run_id) ?? shortId(artifact.run_id);
  const title = artifact.title ? ` title=${clip(artifact.title, 100)}` : "";
  const summary = artifact.summary ? ` summary=${clip(artifact.summary, 160)}` : "";
  return `- artifact ${shortId(artifact.id)} role=${owner} kind=${artifact.kind}${title}${summary} path=${clip(artifact.path, 160)}`;
}

function messageEvidenceLine(message: AgentMessage, roles: Map<string, string>): string {
  const from = roles.get(message.from_run_id) ?? shortId(message.from_run_id);
  const to = message.to_run_id ? (roles.get(message.to_run_id) ?? shortId(message.to_run_id)) : "broadcast";
  const payload = message.payload_json && typeof message.payload_json === "object"
    ? ` payload_keys=${Object.keys(message.payload_json as Record<string, unknown>).join(",") || "-"}`
    : "";
  const artifacts = message.artifact_ids.length ? ` artifacts=${message.artifact_ids.map(shortId).join(",")}` : "";
  return `- message ${shortId(message.id)} ${from}->${to} kind=${message.kind}${artifacts}${payload} text=${clip(message.content_text)}`;
}

function hasVerificationSignal(value: string | null | undefined): boolean {
  return Boolean(value && VERIFICATION_PATTERN.test(value));
}

function verificationLines(params: {
  facts: BlackboardFact[];
  artifacts: AgentArtifact[];
  messages: AgentMessage[];
  roles: Map<string, string>;
  limit: number;
}): string[] {
  const lines: string[] = [];
  for (const fact of params.facts) {
    if (hasVerificationSignal(`${fact.key}\n${fact.content}`)) lines.push(factEvidenceLine(fact));
    if (lines.length >= params.limit) return lines;
  }
  for (const artifact of params.artifacts) {
    if (hasVerificationSignal(`${artifact.title ?? ""}\n${artifact.summary ?? ""}\n${artifact.path}`)) {
      lines.push(artifactEvidenceLine(artifact, params.roles));
    }
    if (lines.length >= params.limit) return lines;
  }
  for (const message of params.messages) {
    if (hasVerificationSignal(message.content_text)) lines.push(messageEvidenceLine(message, params.roles));
    if (lines.length >= params.limit) return lines;
  }
  return lines;
}

function evidenceLines(params: {
  facts: BlackboardFact[];
  artifacts: AgentArtifact[];
  messages: AgentMessage[];
  roles: Map<string, string>;
  limit: number;
}): string[] {
  const lines: string[] = [];
  for (const artifact of params.artifacts.slice(0, params.limit)) {
    lines.push(artifactEvidenceLine(artifact, params.roles));
  }
  for (const fact of params.facts.slice(0, Math.max(0, params.limit - lines.length))) {
    lines.push(factEvidenceLine(fact));
  }
  for (const message of params.messages.slice(-Math.max(0, params.limit - lines.length))) {
    lines.push(messageEvidenceLine(message, params.roles));
  }
  return lines;
}

function riskLines(input: FinalSynthesisInput, runs: AgentRun[], hasVerification: boolean): string[] {
  const lines: string[] = [];
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "cancelled");
  if (input.verdict === "FAIL") {
    lines.push("- evaluator verdict is FAIL; output should not be treated as accepted.");
  }
  for (const item of input.fixList ?? []) {
    lines.push(`- fix_list: ${clip(item, 180)}`);
  }
  for (const run of failedRuns) {
    lines.push(`- ${run.role}(${shortId(run.id)}) ended as ${run.status}${run.error_message ? `: ${clip(run.error_message, 160)}` : ""}`);
  }
  if (!hasVerification) {
    lines.push("- 未找到验证证据；需要人工或后续任务补充 test/build/lint/quality gate 结果。");
  }
  return lines.length ? lines : ["- 未发现新的结构化风险。"];
}

function recommendationLines(input: FinalSynthesisInput, hasVerification: boolean): string[] {
  if (input.verdict === "FAIL") {
    const fixes = (input.fixList ?? []).slice(0, 5).map((item) => `- 优先处理 evaluator fix_list: ${clip(item, 180)}`);
    return fixes.length ? fixes : ["- 先查看 evaluator 输出和 Agent Run trace，再补一个 generator 修复轮次。"];
  }
  if (!hasVerification) {
    return ["- 补跑对应的测试、构建或 quality gate，并把结果写入 artifact/blackboard。"];
  }
  return ["- 可用 /task-log 查看完整 multi-agent trace；交付前保留 artifact id 与验证证据。"];
}

export function buildFinalSynthesis(input: FinalSynthesisInput): string {
  const limit = positiveLimit(input.maxEvidenceItems);
  const runs = listRunsForTask(input.taskId);
  const roles = roleByRunId(runs);
  const facts = listActiveFacts(input.taskId);
  const artifacts = listArtifactsForTask(input.taskId);
  const messages = listMessagesForTask(input.taskId);
  const verification = verificationLines({ facts, artifacts, messages, roles, limit });
  const evidence = evidenceLines({ facts, artifacts, messages, roles, limit });

  return [
    "MiniClaw Agent Run Manager 最终汇总",
    `Verdict: ${input.verdict}`,
    "",
    "## 完成内容",
    input.summary ? `- ${clip(input.summary, 500)}` : "- 未记录结构化 summary。",
    ...runs.filter((run) => run.role !== "supervisor").map(runSummaryLine),
    "",
    "## 关键证据",
    ...(evidence.length ? evidence : ["- 未记录 artifact、blackboard fact 或 agent message。"]),
    "",
    "## 验证结果",
    ...(verification.length ? verification : ["- 未找到验证证据。"]),
    "",
    "## 剩余风险",
    ...riskLines(input, runs, verification.length > 0),
    "",
    "## 后续建议",
    ...recommendationLines(input, verification.length > 0),
  ].join("\n");
}

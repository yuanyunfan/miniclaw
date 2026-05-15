import type {
  AgentArtifactKind,
  AgentMessageKind,
  BlackboardFactConfidence,
  BlackboardFactStatus,
} from "../../store/agent-run-manager.js";
import {
  isAgentArtifactKind,
  isAgentMessageKind,
  isBlackboardFactConfidence,
  isBlackboardFactStatus,
} from "../../store/agent-run-manager.js";

export type ManagedRunVerdict = "PASS" | "FAIL";

export interface ManagedEnvelopeMessage {
  to_run_id?: string;
  to_role?: string;
  kind: AgentMessageKind;
  content_text?: string;
  payload_json?: unknown;
  artifact_ids?: string[];
  causal_message_id?: string;
}

export interface ManagedEnvelopeArtifact {
  kind: AgentArtifactKind;
  title?: string;
  summary?: string;
  content?: string;
  path?: string;
}

export interface ManagedEnvelopeBlackboardFact {
  key: string;
  content: string;
  confidence: BlackboardFactConfidence;
  status?: BlackboardFactStatus;
}

export interface ManagedChildEnvelope {
  summary?: string;
  verdict?: ManagedRunVerdict;
  fix_list?: string[];
  messages: ManagedEnvelopeMessage[];
  artifacts: ManagedEnvelopeArtifact[];
  blackboard_facts: ManagedEnvelopeBlackboardFact[];
}

const EMPTY_ENVELOPE: ManagedChildEnvelope = {
  messages: [],
  artifacts: [],
  blackboard_facts: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeVerdict(value: unknown): ManagedRunVerdict | undefined {
  if (value !== "PASS" && value !== "FAIL") return undefined;
  return value;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function candidateJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fencePattern = /```(?:json|miniclaw_agent_envelope)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fencePattern)) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) blocks.push(trimmed);
  return blocks;
}

function normalizeMessage(value: unknown): ManagedEnvelopeMessage | undefined {
  if (!isRecord(value) || !isAgentMessageKind(value.kind)) return undefined;
  return {
    kind: value.kind,
    ...(optionalString(value.to_run_id) ? { to_run_id: optionalString(value.to_run_id) } : {}),
    ...(optionalString(value.to_role) ? { to_role: optionalString(value.to_role) } : {}),
    ...(optionalString(value.content_text ?? value.content) ? { content_text: optionalString(value.content_text ?? value.content) } : {}),
    ...("payload_json" in value ? { payload_json: value.payload_json } : "payload" in value ? { payload_json: value.payload } : {}),
    ...(stringArray(value.artifact_ids ?? value.artifacts) ? { artifact_ids: stringArray(value.artifact_ids ?? value.artifacts) } : {}),
    ...(optionalString(value.causal_message_id) ? { causal_message_id: optionalString(value.causal_message_id) } : {}),
  };
}

function normalizeArtifact(value: unknown): ManagedEnvelopeArtifact | undefined {
  if (!isRecord(value) || !isAgentArtifactKind(value.kind)) return undefined;
  return {
    kind: value.kind,
    ...(optionalString(value.title) ? { title: optionalString(value.title) } : {}),
    ...(optionalString(value.summary) ? { summary: optionalString(value.summary) } : {}),
    ...(optionalString(value.content) ? { content: optionalString(value.content) } : {}),
    ...(optionalString(value.path) ? { path: optionalString(value.path) } : {}),
  };
}

function normalizeFact(value: unknown): ManagedEnvelopeBlackboardFact | undefined {
  if (!isRecord(value)) return undefined;
  const key = optionalString(value.key);
  const content = optionalString(value.content);
  const confidence = value.confidence;
  const status = value.status;
  if (!key || !content || !isBlackboardFactConfidence(confidence)) return undefined;
  return {
    key,
    content,
    confidence,
    ...(isBlackboardFactStatus(status) ? { status } : {}),
  };
}

function normalizeEnvelope(raw: Record<string, unknown>): ManagedChildEnvelope {
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(normalizeMessage).filter((message): message is ManagedEnvelopeMessage => !!message)
    : [];
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map(normalizeArtifact).filter((artifact): artifact is ManagedEnvelopeArtifact => !!artifact)
    : [];
  const blackboardFacts = Array.isArray(raw.blackboard_facts)
    ? raw.blackboard_facts.map(normalizeFact).filter((fact): fact is ManagedEnvelopeBlackboardFact => !!fact)
    : [];
  const summary = optionalString(raw.summary);
  const verdict = normalizeVerdict(raw.verdict);
  const fixList = stringArray(raw.fix_list);
  return {
    messages,
    artifacts,
    blackboard_facts: blackboardFacts,
    ...(summary ? { summary } : {}),
    ...(verdict ? { verdict } : {}),
    ...(fixList?.length ? { fix_list: fixList } : {}),
  };
}

export function extractManagedChildEnvelope(text: string): ManagedChildEnvelope {
  for (const block of candidateJsonBlocks(text)) {
    const parsed = parseJsonObject(block);
    if (!parsed) continue;
    return normalizeEnvelope(parsed);
  }
  const summary = optionalString(text.replace(/```[\s\S]*?```/g, "").trim());
  return summary ? { ...EMPTY_ENVELOPE, summary } : { ...EMPTY_ENVELOPE };
}

export function formatManagedEnvelopeInstruction(role: string): string {
  return [
    "Return your final response as a fenced JSON block tagged `miniclaw_agent_envelope`.",
    "The JSON object may contain: summary, messages, artifacts, blackboard_facts, verdict, fix_list.",
    `Current role: ${role}. Keep payloads compact; large outputs must be artifact references or short artifact content.`,
  ].join("\n");
}

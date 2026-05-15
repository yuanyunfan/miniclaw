import {
  createRun,
  getRun,
  type AgentArtifact,
  type AgentArtifactKind,
  type AgentMessage,
  type AgentMessageKind,
  type AgentRun,
  type BlackboardFact,
  type BlackboardFactConfidence,
} from "../../../store/agent-run-manager.js";
import {
  buildTaskTraceModel,
  formatTaskTraceSummary,
  renderTaskTraceMarkdown,
} from "../../../store/task-trace-export.js";
import { AgentBus } from "../bus.js";

export interface AgentRunAcpAdapterParams {
  taskId: string;
  cwd: string;
  bus: AgentBus;
  token?: string;
}

export interface AcpManifest {
  name: "miniclaw-agent-run-manager";
  version: "0.1.0";
  capabilities: string[];
  auth: "none" | "bearer";
}

export interface AcpTraceExport {
  task_id: string;
  summary: string;
  redaction_policy: string;
  markdown: string;
}

export class AgentRunAcpAdapter {
  constructor(private readonly params: AgentRunAcpAdapterParams) {}

  manifest(token?: string): AcpManifest {
    this.assertToken(token);
    return {
      name: "miniclaw-agent-run-manager",
      version: "0.1.0",
      capabilities: ["manifest", "session_run", "message", "artifact_reference", "blackboard", "trace_export"],
      auth: this.params.token ? "bearer" : "none",
    };
  }

  createExternalRun(input: {
    role: string;
    parentRunId?: string;
    token?: string;
  }): AgentRun {
    this.assertToken(input.token);
    const parent = input.parentRunId ? getRun(input.parentRunId) : undefined;
    if (input.parentRunId && !parent) throw new Error(`Unknown ACP parent run: ${input.parentRunId}`);
    if (parent && parent.task_id !== this.params.taskId) {
      throw new Error(`ACP parent run ${parent.id} does not belong to task ${this.params.taskId}`);
    }
    const run = createRun({
      taskId: this.params.taskId,
      parentRunId: parent?.id,
      controllerRunId: parent?.id,
      requesterRunId: parent?.id,
      role: input.role,
      runtime: "external-acp",
      providerSessionId: `acp:${input.role}:${this.params.taskId}`,
      controlScope: parent ? "child" : "peer",
      contextMode: "isolated",
      cwd: this.params.cwd,
      toolPolicyId: "external-acp",
      canSendKinds: ["finding", "question", "answer", "artifact", "verdict", "error"],
      canReceiveKinds: ["finding", "question", "answer", "challenge", "handoff", "artifact", "verdict", "error"],
      spawnDepth: parent ? parent.spawn_depth + 1 : 0,
    });
    return run;
  }

  postMessage(input: {
    fromRunId: string;
    toRunId?: string;
    kind: AgentMessageKind;
    contentText?: string;
    payload?: unknown;
    artifactIds?: string[];
    token?: string;
  }): AgentMessage {
    this.assertToken(input.token);
    return this.params.bus.sendMessage({
      taskId: this.params.taskId,
      fromRunId: input.fromRunId,
      ...(input.toRunId ? { toRunId: input.toRunId } : {}),
      kind: input.kind,
      ...(input.contentText ? { contentText: input.contentText } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.artifactIds ? { artifactIds: input.artifactIds } : {}),
    });
  }

  readMailbox(input: { runId: string; afterCursor?: string; token?: string }): AgentMessage[] {
    this.assertToken(input.token);
    return this.params.bus.readMailbox({
      runId: input.runId,
      ...(input.afterCursor ? { afterCursor: input.afterCursor } : {}),
    });
  }

  publishArtifact(input: {
    runId: string;
    kind: AgentArtifactKind;
    title?: string;
    content?: string;
    path?: string;
    summary?: string;
    token?: string;
  }): AgentArtifact {
    this.assertToken(input.token);
    return this.params.bus.publishArtifact({
      taskId: this.params.taskId,
      runId: input.runId,
      kind: input.kind,
      cwd: this.params.cwd,
      ...(input.title ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.path ? { path: input.path } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
    });
  }

  readArtifact(input: { artifactId: string; token?: string }): { artifact: AgentArtifact; content: string | null } | undefined {
    this.assertToken(input.token);
    return this.params.bus.readArtifact(input.artifactId, this.params.cwd);
  }

  listBlackboard(token?: string): BlackboardFact[] {
    this.assertToken(token);
    return this.params.bus.listBlackboard(this.params.taskId);
  }

  upsertBlackboardFact(input: {
    key: string;
    content: string;
    confidence: BlackboardFactConfidence;
    sourceMessageId: string;
    token?: string;
  }): BlackboardFact {
    this.assertToken(input.token);
    return this.params.bus.upsertBlackboardFact({
      taskId: this.params.taskId,
      key: input.key,
      content: input.content,
      confidence: input.confidence,
      sourceMessageId: input.sourceMessageId,
    });
  }

  exportTrace(input: { token?: string; maxEvents?: number; maxBytes?: number } = {}): AcpTraceExport {
    this.assertToken(input.token);
    const model = buildTaskTraceModel(this.params.taskId, { maxEvents: input.maxEvents });
    if (!model.ok) throw new Error(model.error.message);
    return {
      task_id: this.params.taskId,
      summary: formatTaskTraceSummary(model.value),
      redaction_policy: model.value.redactionPolicy,
      markdown: renderTaskTraceMarkdown(model.value, { maxBytes: input.maxBytes }),
    };
  }

  private assertToken(token: string | undefined): void {
    if (this.params.token && token !== this.params.token) {
      throw new Error("ACP token rejected");
    }
  }
}

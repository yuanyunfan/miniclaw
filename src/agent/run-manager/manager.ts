import type { SendableChannels, Message } from "discord.js";
import { getTask } from "../../store/db.js";
import {
  createRun,
  listActiveChildren,
  listRunsForTask,
  updateRunStatus,
  type AgentContextMode,
  type AgentControlScope,
  type AgentMessageKind,
  type AgentRun,
  type AgentRuntimeId,
  type DiscordRouteState,
} from "../../store/agent-run-manager.js";
import type { AgentTaskResult } from "../../runtime/agent-runtime.js";
import { taskViewEvents } from "../task-view-events.js";
import type { TaskReporter } from "../task-reporter.js";
import { AgentBus } from "./bus.js";

const ALL_MESSAGE_KINDS: AgentMessageKind[] = [
  "finding",
  "question",
  "answer",
  "challenge",
  "decision",
  "handoff",
  "artifact",
  "verdict",
  "error",
];

export interface AgentRunManagerParams {
  taskId: string;
  cwd: string;
  provider: AgentRuntimeId;
  reporter: TaskReporter;
  channel: SendableChannels;
  statusMessage?: Message;
  deliveryChannelId?: string;
}

export interface ManagedFakeRunInput {
  prompt: string;
  signal: AbortSignal;
  onViewEvent: (event: ReturnType<typeof taskViewEvents.toolProgress> | ReturnType<typeof taskViewEvents.sessionStarted>) => Promise<void> | void;
}

interface SpawnInput {
  parent: AgentRun;
  role: string;
  toolPolicyId: string;
  controlScope?: AgentControlScope;
  contextMode?: AgentContextMode;
  canSpawn?: boolean;
  canWriteWorkspace?: boolean;
  canSendKinds?: string[];
  canReceiveKinds?: string[];
}

function channelIdOf(channel: SendableChannels): string | undefined {
  const candidate = channel as { id?: unknown };
  return typeof candidate.id === "string" ? candidate.id : undefined;
}

function compactResult(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 180) : "empty task prompt";
}

export class AgentRunManager {
  readonly bus = new AgentBus();

  constructor(private readonly params: AgentRunManagerParams) {}

  createRouteState(): DiscordRouteState {
    const task = getTask(this.params.taskId);
    return {
      discord_channel_id: this.params.deliveryChannelId ?? channelIdOf(this.params.channel),
      discord_thread_id: task?.discord_thread_id ?? undefined,
      discord_message_id: this.params.statusMessage?.id ?? task?.progress_message_id ?? undefined,
      requester_user_id: task?.discord_user_id ?? undefined,
      root_task_id: this.params.taskId,
    };
  }

  async runFakePlannerGeneratorEvaluator(input: ManagedFakeRunInput): Promise<AgentTaskResult> {
    const startedAt = Date.now();
    const root = this.createRootRun();
    const sessionId = `manager:${root.id}`;
    await input.onViewEvent(taskViewEvents.sessionStarted("agent-run-manager", sessionId));
    this.params.reporter.event("session_started", {
      message: sessionId,
      payload: { provider: "agent-run-manager", session_id: sessionId, root_run_id: root.id },
    });

    if (input.signal.aborted) {
      this.cancelTask("task cancelled before Agent Run Manager start");
      return this.cancelledResult(startedAt, sessionId);
    }

    const planner = this.spawnAgent({
      parent: root,
      role: "planner",
      toolPolicyId: "read-only",
      canSendKinds: ["decision", "handoff", "artifact"],
      canReceiveKinds: ["question", "challenge"],
    });
    const generator = this.spawnAgent({
      parent: root,
      role: "generator",
      toolPolicyId: "workspace-write",
      canWriteWorkspace: true,
      canSendKinds: ["artifact", "finding"],
      canReceiveKinds: ["handoff", "question"],
    });
    const evaluator = this.spawnAgent({
      parent: root,
      role: "evaluator",
      toolPolicyId: "read-only",
      canSendKinds: ["verdict", "challenge"],
      canReceiveKinds: ["artifact", "handoff"],
    });

    const generatorWait = this.bus.waitForMessage({
      runId: generator.id,
      kinds: ["handoff"],
      timeoutMs: 1000,
    });
    const planArtifact = this.bus.publishArtifact({
      taskId: this.params.taskId,
      runId: planner.id,
      kind: "markdown",
      cwd: this.params.cwd,
      title: "Fake manager plan",
      summary: "planner -> generator -> evaluator",
      content: [
        "# Fake Manager Plan",
        "",
        `Task: ${compactResult(input.prompt)}`,
        "",
        "1. planner prepares a compact handoff.",
        "2. generator publishes an implementation artifact.",
        "3. evaluator returns PASS verdict.",
      ].join("\n"),
    });
    const handoff = this.bus.sendMessage({
      taskId: this.params.taskId,
      fromRunId: planner.id,
      toRunId: generator.id,
      kind: "handoff",
      contentText: "Implement the planned fake Agent Run Manager fixture.",
      payload: { acceptance: ["artifact_written", "verdict_pass"] },
      artifactIds: [planArtifact.id],
    });
    this.params.reporter.event("agent_message_posted", {
      payload: { message_id: handoff.id, from_run_id: planner.id, to_run_id: generator.id, kind: handoff.kind },
    });
    await generatorWait;
    updateRunStatus(planner.id, "completed");
    this.params.reporter.event("agent_run_completed", {
      payload: { run_id: planner.id, role: planner.role, status: "completed" },
    });
    await input.onViewEvent(taskViewEvents.toolProgress({
      provider: "agent-run-manager",
      title: "planner: handoff created",
      countAsTool: false,
    }));

    const evaluatorWait = this.bus.waitForMessage({
      runId: evaluator.id,
      kinds: ["artifact"],
      timeoutMs: 1000,
    });
    const generatorArtifact = this.bus.publishArtifact({
      taskId: this.params.taskId,
      runId: generator.id,
      kind: "markdown",
      cwd: this.params.cwd,
      title: "Fake implementation notes",
      summary: "generator produced a managed-run artifact",
      content: [
        "# Fake Implementation Notes",
        "",
        "This artifact proves large child output is referenced through agent_artifacts.",
      ].join("\n"),
    });
    this.params.reporter.event("artifact_written", {
      payload: {
        artifact_id: generatorArtifact.id,
        run_id: generator.id,
        kind: generatorArtifact.kind,
        path: generatorArtifact.path,
      },
    });
    const artifactMessage = this.bus.sendMessage({
      taskId: this.params.taskId,
      fromRunId: generator.id,
      toRunId: evaluator.id,
      kind: "artifact",
      contentText: "Generated artifact is ready for evaluation.",
      artifactIds: [generatorArtifact.id],
      causalMessageId: handoff.id,
    });
    this.params.reporter.event("agent_message_posted", {
      payload: { message_id: artifactMessage.id, from_run_id: generator.id, to_run_id: evaluator.id, kind: artifactMessage.kind },
    });
    await evaluatorWait;
    updateRunStatus(generator.id, "completed");
    this.params.reporter.event("agent_run_completed", {
      payload: { run_id: generator.id, role: generator.role, status: "completed" },
    });
    await input.onViewEvent(taskViewEvents.toolProgress({
      provider: "agent-run-manager",
      title: "generator: artifact written",
      detail: generatorArtifact.summary ?? undefined,
      countAsTool: false,
    }));

    const verdict = this.bus.sendMessage({
      taskId: this.params.taskId,
      fromRunId: evaluator.id,
      toRunId: root.id,
      kind: "verdict",
      contentText: "PASS",
      payload: { verdict: "PASS", checked_artifacts: [generatorArtifact.id] },
      causalMessageId: artifactMessage.id,
    });
    this.params.reporter.event("verdict_received", {
      payload: { message_id: verdict.id, from_run_id: evaluator.id, verdict: "PASS" },
    });
    this.bus.upsertBlackboardFact({
      taskId: this.params.taskId,
      key: "final_verdict",
      content: "PASS",
      sourceMessageId: verdict.id,
      confidence: "high",
    });
    this.params.reporter.event("blackboard_fact_upserted", {
      payload: { key: "final_verdict", source_message_id: verdict.id, confidence: "high" },
    });
    updateRunStatus(evaluator.id, "completed");
    updateRunStatus(root.id, "completed");
    this.params.reporter.event("agent_run_completed", {
      payload: { run_id: evaluator.id, role: evaluator.role, status: "completed" },
    });
    this.params.reporter.event("agent_run_completed", {
      payload: { run_id: root.id, role: root.role, status: "completed" },
    });
    await input.onViewEvent(taskViewEvents.toolProgress({
      provider: "agent-run-manager",
      title: "evaluator: verdict PASS",
      countAsTool: false,
    }));

    const activeFacts = this.bus.listBlackboard(this.params.taskId);
    const durationMs = Date.now() - startedAt;
    return {
      success: true,
      sessionId,
      costUsd: 0,
      durationMs,
      turns: 3,
      result: [
        "Agent Run Manager fake E2E completed.",
        "Flow: planner -> generator -> evaluator.",
        `Verdict: ${activeFacts.find((fact) => fact.key === "final_verdict")?.content ?? "UNKNOWN"}.`,
      ].join("\n"),
      tokensSummary: "manager=fake",
      progressLines: [
        "supervisor: root run created",
        "planner: handoff created",
        "generator: artifact written",
        "evaluator: verdict PASS",
      ],
      toolCount: 0,
    };
  }

  cancelTask(reason: string): void {
    for (const run of listRunsForTask(this.params.taskId)) {
      if (run.status === "queued" || run.status === "running" || run.status === "waiting") {
        updateRunStatus(run.id, "cancelled", { errorMessage: reason });
        this.params.reporter.event("agent_run_completed", {
          severity: "warning",
          payload: { run_id: run.id, role: run.role, status: "cancelled", reason },
        });
      }
    }
    this.bus.dispose();
  }

  activeChildren(parentRunId: string): AgentRun[] {
    return listActiveChildren(parentRunId);
  }

  private createRootRun(): AgentRun {
    const root = createRun({
      taskId: this.params.taskId,
      role: "supervisor",
      runtime: this.params.provider,
      controlScope: "root",
      contextMode: "isolated",
      cwd: this.params.cwd,
      toolPolicyId: "supervisor",
      canSpawn: true,
      canSendKinds: ALL_MESSAGE_KINDS,
      canReceiveKinds: ALL_MESSAGE_KINDS,
      route: this.createRouteState(),
    });
    this.params.reporter.event("agent_run_started", {
      payload: { run_id: root.id, role: root.role, runtime: root.runtime, spawn_depth: root.spawn_depth },
    });
    return root;
  }

  private spawnAgent(input: SpawnInput): AgentRun {
    const run = createRun({
      taskId: this.params.taskId,
      parentRunId: input.parent.id,
      controllerRunId: input.parent.id,
      requesterRunId: input.parent.id,
      role: input.role,
      runtime: this.params.provider,
      controlScope: input.controlScope ?? "child",
      contextMode: input.contextMode ?? "isolated",
      cwd: this.params.cwd,
      toolPolicyId: input.toolPolicyId,
      canSpawn: input.canSpawn ?? false,
      canWriteWorkspace: input.canWriteWorkspace ?? false,
      canSendKinds: input.canSendKinds ?? [],
      canReceiveKinds: input.canReceiveKinds ?? [],
      spawnDepth: input.parent.spawn_depth + 1,
      providerSessionId: `${this.params.provider}:${input.role}:${this.params.taskId}`,
    });
    this.params.reporter.event("agent_run_started", {
      payload: {
        run_id: run.id,
        parent_run_id: run.parent_run_id,
        role: run.role,
        runtime: run.runtime,
        spawn_depth: run.spawn_depth,
      },
    });
    return run;
  }

  private cancelledResult(startedAt: number, sessionId: string): AgentTaskResult {
    const durationMs = Date.now() - startedAt;
    return {
      success: false,
      sessionId,
      costUsd: 0,
      durationMs,
      turns: 0,
      result: "任务已被用户取消",
      progressLines: [],
      toolCount: 0,
    };
  }
}

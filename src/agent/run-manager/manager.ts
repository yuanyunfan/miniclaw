import type { SendableChannels, Message } from "discord.js";
import { getTask } from "../../store/db.js";
import {
  createRun,
  listActiveChildren,
  listRunsForTask,
  updateRunStatus,
  type AgentContextMode,
  type AgentControlScope,
  type AgentMessage,
  type AgentMessageKind,
  type AgentRun,
  type AgentRuntimeId,
  type DiscordRouteState,
} from "../../store/agent-run-manager.js";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { AgentTaskResult } from "../../runtime/agent-runtime.js";
import { taskViewEvents, type TaskViewEvent } from "../task-view-events.js";
import type { TaskReporter } from "../task-reporter.js";
import { AgentBus } from "./bus.js";
import {
  extractManagedChildEnvelope,
  formatManagedEnvelopeInstruction,
  type ManagedChildEnvelope,
  type ManagedEnvelopeMessage,
  type ManagedRunVerdict,
} from "./envelope.js";
import { resolveAgentRunManagerPolicy, type AgentRunManagerPolicy, type AgentRunManagerPolicyInput } from "./policy.js";

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
  policy?: AgentRunManagerPolicyInput;
}

export interface ManagedFakeRunInput {
  prompt: string;
  signal: AbortSignal;
  onViewEvent: (event: ReturnType<typeof taskViewEvents.toolProgress> | ReturnType<typeof taskViewEvents.sessionStarted>) => Promise<void> | void;
}

export interface ManagedRuntimeRunInput {
  prompt: string;
  signal: AbortSignal;
  runtime: AgentRuntime;
  onViewEvent: (event: TaskViewEvent) => Promise<void> | void;
  maxFixIterations?: number;
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

interface ManagedChildTurn {
  run: AgentRun;
  result: AgentTaskResult;
  envelope: ManagedChildEnvelope;
  messages: AgentMessage[];
  artifactIds: string[];
}

const MANAGED_ROLE_CAPABILITIES: Record<string, Pick<SpawnInput, "toolPolicyId" | "canWriteWorkspace" | "canSendKinds" | "canReceiveKinds">> = {
  planner: {
    toolPolicyId: "read-only",
    canSendKinds: ["decision", "handoff", "question", "artifact", "error"],
    canReceiveKinds: ["finding", "answer", "challenge", "question"],
  },
  generator: {
    toolPolicyId: "workspace-write",
    canWriteWorkspace: true,
    canSendKinds: ["artifact", "finding", "answer", "error"],
    canReceiveKinds: ["handoff", "question", "challenge"],
  },
  evaluator: {
    toolPolicyId: "read-only",
    canSendKinds: ["verdict", "challenge", "error"],
    canReceiveKinds: ["artifact", "handoff"],
  },
  "final-synthesizer": {
    toolPolicyId: "read-only",
    canSendKinds: ["decision", "artifact"],
    canReceiveKinds: ["verdict", "finding", "artifact"],
  },
};

function channelIdOf(channel: SendableChannels): string | undefined {
  const candidate = channel as { id?: unknown };
  return typeof candidate.id === "string" ? candidate.id : undefined;
}

function compactResult(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 180) : "empty task prompt";
}

export class AgentRunManager {
  readonly bus: AgentBus;
  readonly policy: AgentRunManagerPolicy;

  constructor(private readonly params: AgentRunManagerParams) {
    this.policy = resolveAgentRunManagerPolicy(params.policy);
    this.bus = new AgentBus({
      maxMessages: this.policy.maxMessages,
      maxArtifactBytes: this.policy.maxArtifactBytes,
      maxPingPongTurns: this.policy.maxPingPongTurns,
    });
  }

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

  async runManagedRuntime(input: ManagedRuntimeRunInput): Promise<AgentTaskResult> {
    const startedAt = Date.now();
    const root = this.createRootRun();
    const sessionId = `manager:${root.id}`;
    await input.onViewEvent(taskViewEvents.sessionStarted("agent-run-manager", sessionId));
    this.params.reporter.event("session_started", {
      message: sessionId,
      payload: { provider: "agent-run-manager", session_id: sessionId, root_run_id: root.id },
    });
    const abortListener = () => this.cancelTask("task cancelled by root signal");
    input.signal.addEventListener("abort", abortListener, { once: true });

    try {
      if (input.signal.aborted) {
        this.cancelTask("task cancelled before Agent Run Manager start");
        return this.cancelledResult(startedAt, sessionId);
      }

      const planner = this.spawnManagedRole(root, "planner");
      const plannerTurn = await this.runProviderChild({
        run: planner,
        runtime: input.runtime,
        prompt: this.buildChildPrompt({
          role: "planner",
          taskPrompt: input.prompt,
          instruction: "Create a compact orchestration handoff for the generator and record key acceptance criteria.",
        }),
        signal: input.signal,
        onViewEvent: input.onViewEvent,
      });
      if (input.signal.aborted) return this.cancelledResult(startedAt, sessionId);
      if (!plannerTurn.result.success) return this.failedResult(startedAt, sessionId, root.id, `planner failed: ${plannerTurn.result.result}`);

      let generatorTurn = await this.runGeneratorTurn({
        root,
        runtime: input.runtime,
        taskPrompt: input.prompt,
        plannerSummary: plannerTurn.envelope.summary,
        signal: input.signal,
        onViewEvent: input.onViewEvent,
      });
      if (input.signal.aborted) return this.cancelledResult(startedAt, sessionId);
      if (!generatorTurn.result.success) return this.failedResult(startedAt, sessionId, root.id, `generator failed: ${generatorTurn.result.result}`);

      let finalVerdict: ManagedRunVerdict = "FAIL";
      let finalSummary = "";
      const maxFixIterations = Math.max(0, input.maxFixIterations ?? this.policy.maxFixIterations);
      for (let iteration = 0; iteration <= maxFixIterations; iteration++) {
        const evaluator = this.spawnManagedRole(root, "evaluator");
        const evaluatorTurn = await this.runProviderChild({
          run: evaluator,
          runtime: input.runtime,
          prompt: this.buildChildPrompt({
            role: "evaluator",
            taskPrompt: input.prompt,
            instruction: [
              "Evaluate the latest generator artifact.",
              "Set verdict to PASS when acceptance criteria are satisfied; otherwise set verdict to FAIL and include fix_list.",
            ].join(" "),
            extra: {
              generator_summary: generatorTurn.envelope.summary,
              generator_artifact_ids: generatorTurn.artifactIds,
              fix_iteration: iteration,
            },
          }),
          signal: input.signal,
          onViewEvent: input.onViewEvent,
        });
        if (input.signal.aborted) return this.cancelledResult(startedAt, sessionId);
        if (!evaluatorTurn.result.success) return this.failedResult(startedAt, sessionId, root.id, `evaluator failed: ${evaluatorTurn.result.result}`);

        finalVerdict = evaluatorTurn.envelope.verdict ?? this.inferVerdict(evaluatorTurn);
        finalSummary = evaluatorTurn.envelope.summary ?? evaluatorTurn.result.result;
        this.recordFinalVerdict(evaluatorTurn.run, root, finalVerdict, evaluatorTurn.envelope.fix_list ?? []);
        await input.onViewEvent(taskViewEvents.toolProgress({
          provider: "agent-run-manager",
          title: `evaluator: verdict ${finalVerdict}`,
          countAsTool: false,
          ...(finalVerdict === "FAIL" ? { severity: "warning" } : {}),
        }));

        if (finalVerdict === "PASS") {
          updateRunStatus(root.id, "completed");
          this.params.reporter.event("agent_run_completed", {
            payload: { run_id: root.id, role: root.role, status: "completed" },
          });
          const durationMs = Date.now() - startedAt;
          return {
            success: true,
            sessionId,
            costUsd: plannerTurn.result.costUsd + generatorTurn.result.costUsd + evaluatorTurn.result.costUsd,
            durationMs,
            turns: plannerTurn.result.turns + generatorTurn.result.turns + evaluatorTurn.result.turns,
            result: this.synthesizeFinalResult(finalVerdict, finalSummary),
            tokensSummary: "manager=managed-envelope",
            progressLines: this.progressLinesForTask(),
            toolCount: 0,
          };
        }

        if (iteration >= maxFixIterations) break;
        generatorTurn = await this.runGeneratorTurn({
          root,
          runtime: input.runtime,
          taskPrompt: input.prompt,
          plannerSummary: plannerTurn.envelope.summary,
          fixList: evaluatorTurn.envelope.fix_list ?? ["Evaluator returned FAIL without a structured fix list."],
          signal: input.signal,
          onViewEvent: input.onViewEvent,
        });
        if (input.signal.aborted) return this.cancelledResult(startedAt, sessionId);
        if (!generatorTurn.result.success) return this.failedResult(startedAt, sessionId, root.id, `generator fix failed: ${generatorTurn.result.result}`);
      }

      updateRunStatus(root.id, "failed", { errorMessage: "evaluator returned FAIL after max fix iterations" });
      this.params.reporter.event("agent_run_completed", {
        severity: "error",
        payload: { run_id: root.id, role: root.role, status: "failed", verdict: finalVerdict },
      });
      return {
        success: false,
        sessionId,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
        turns: 0,
        result: this.synthesizeFinalResult(finalVerdict, finalSummary || "Evaluator returned FAIL after max fix iterations."),
        tokensSummary: "manager=managed-envelope",
        progressLines: this.progressLinesForTask(),
        toolCount: 0,
      };
    } catch (err) {
      if (input.signal.aborted) return this.cancelledResult(startedAt, sessionId);
      const message = err instanceof Error ? err.message : String(err);
      return this.failedResult(startedAt, sessionId, root.id, message);
    } finally {
      input.signal.removeEventListener("abort", abortListener);
    }
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
    if (!input.parent.can_spawn) {
      throw new Error(`Agent run ${input.parent.id} role=${input.parent.role} cannot spawn child runs`);
    }
    const spawnDepth = input.parent.spawn_depth + 1;
    if (spawnDepth > this.policy.maxSpawnDepth) {
      throw new Error(`Agent Run Manager spawn depth limit exceeded: next_depth=${spawnDepth} max_spawn_depth=${this.policy.maxSpawnDepth}`);
    }
    const existingRuns = listRunsForTask(this.params.taskId);
    const childCount = existingRuns.filter((run) => run.parent_run_id === input.parent.id).length;
    if (childCount >= this.policy.maxChildrenPerRun) {
      throw new Error(`Agent Run Manager child fan-out limit exceeded for run ${input.parent.id}: max_children_per_run=${this.policy.maxChildrenPerRun}`);
    }
    const totalChildTurns = existingRuns.filter((run) => run.parent_run_id !== null).length;
    if (totalChildTurns >= this.policy.maxTurns) {
      throw new Error(`Agent Run Manager turn limit exceeded for task ${this.params.taskId}: max_turns=${this.policy.maxTurns}`);
    }
    const activeChildRuns = existingRuns.filter((run) =>
      run.control_scope !== "root" && (run.status === "queued" || run.status === "running" || run.status === "waiting")
    ).length;
    if (activeChildRuns >= this.policy.maxConcurrentRuns) {
      throw new Error(`Agent Run Manager concurrency limit exceeded for task ${this.params.taskId}: max_concurrent_runs=${this.policy.maxConcurrentRuns}`);
    }

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
      spawnDepth,
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

  private spawnManagedRole(parent: AgentRun, role: string): AgentRun {
    const capabilities = MANAGED_ROLE_CAPABILITIES[role];
    if (!capabilities) throw new Error(`Unknown managed role: ${role}`);
    return this.spawnAgent({
      parent,
      role,
      ...capabilities,
    });
  }

  private async runGeneratorTurn(input: {
    root: AgentRun;
    runtime: AgentRuntime;
    taskPrompt: string;
    plannerSummary?: string;
    fixList?: string[];
    signal: AbortSignal;
    onViewEvent: (event: TaskViewEvent) => Promise<void> | void;
  }): Promise<ManagedChildTurn> {
    const generator = this.spawnManagedRole(input.root, "generator");
    return await this.runProviderChild({
      run: generator,
      runtime: input.runtime,
      prompt: this.buildChildPrompt({
        role: "generator",
        taskPrompt: input.taskPrompt,
        instruction: input.fixList?.length
          ? "Apply the evaluator fix_list and publish a revised artifact. Do not rewrite unrelated files."
          : "Implement the planner handoff or produce the requested artifact. Keep large output in artifacts.",
        extra: {
          planner_summary: input.plannerSummary,
          fix_list: input.fixList,
        },
      }),
      signal: input.signal,
      onViewEvent: input.onViewEvent,
    });
  }

  private async runProviderChild(input: {
    run: AgentRun;
    runtime: AgentRuntime;
    prompt: string;
    signal: AbortSignal;
    onViewEvent: (event: TaskViewEvent) => Promise<void> | void;
  }): Promise<ManagedChildTurn> {
    await input.onViewEvent(taskViewEvents.toolProgress({
      provider: "agent-run-manager",
      title: `${input.run.role}: child run started`,
      countAsTool: false,
    }));
    const childController = new AbortController();
    let timedOut = false;
    const forwardAbort = () => childController.abort(input.signal.reason);
    if (input.signal.aborted) forwardAbort();
    else input.signal.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      childController.abort(new Error(`${input.run.role} timed out after ${this.policy.timeoutMs}ms`));
    }, this.policy.timeoutMs);
    timeout.unref?.();

    let result: AgentTaskResult;
    try {
      result = await input.runtime.startTask({
        taskId: this.params.taskId,
        prompt: input.prompt,
        cwd: this.params.cwd,
        signal: childController.signal,
        onViewEvent: async (event) => {
          if (event.type === "task_completed" || event.type === "task_failed" || event.type === "session_started") return;
          if (event.type === "tool_progress") {
            await input.onViewEvent(taskViewEvents.toolProgress({
              provider: "agent-run-manager",
              title: `${input.run.role}: ${event.title}`,
              ...(event.detail ? { detail: event.detail } : {}),
              ...(event.severity ? { severity: event.severity } : {}),
              countAsTool: event.countAsTool ?? false,
            }));
            return;
          }
          await input.onViewEvent(event);
        },
        onTraceEvent: (eventType, options) => {
          this.params.reporter.event(`agent_child_${eventType}`, {
            ...(options?.severity ? { severity: options.severity } : {}),
            ...(options?.message ? { message: options.message } : {}),
            payload: {
              run_id: input.run.id,
              role: input.run.role,
              runtime: input.runtime.id,
              event_type: eventType,
              ...(options?.payload !== undefined ? { child_payload: options.payload } : {}),
            },
          });
        },
      });
    } catch (err) {
      if (!timedOut) throw err;
      result = {
        success: false,
        sessionId: `${this.params.provider}:${input.run.role}:timeout`,
        costUsd: 0,
        durationMs: this.policy.timeoutMs,
        turns: 0,
        result: `${input.run.role} timed out after ${this.policy.timeoutMs}ms`,
        progressLines: [],
        toolCount: 0,
      };
    } finally {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", forwardAbort);
    }

    if (input.signal.aborted) {
      updateRunStatus(input.run.id, "cancelled", {
        providerSessionId: result.sessionId,
        errorMessage: "task cancelled by root signal",
      });
      return {
        run: input.run,
        result: { ...result, success: false, result: "任务已被用户取消" },
        envelope: { messages: [], artifacts: [], blackboard_facts: [] },
        messages: [],
        artifactIds: [],
      };
    }

    if (timedOut) {
      result = {
        ...result,
        success: false,
        durationMs: Math.max(result.durationMs, this.policy.timeoutMs),
        result: `${input.run.role} timed out after ${this.policy.timeoutMs}ms`,
      };
      updateRunStatus(input.run.id, "failed", {
        providerSessionId: result.sessionId,
        errorMessage: result.result,
      });
      this.params.reporter.event("agent_run_completed", {
        severity: "error",
        payload: {
          run_id: input.run.id,
          role: input.run.role,
          status: "failed",
          provider_session_id: result.sessionId,
          reason: "timeout",
          timeout_ms: this.policy.timeoutMs,
        },
      });
      return {
        run: input.run,
        result,
        envelope: { messages: [], artifacts: [], blackboard_facts: [] },
        messages: [],
        artifactIds: [],
      };
    }

    const envelope = extractManagedChildEnvelope(result.result);
    const persisted = this.persistEnvelope(input.run, envelope);
    updateRunStatus(input.run.id, result.success ? "completed" : "failed", {
      providerSessionId: result.sessionId,
      ...(result.success ? {} : { errorMessage: result.result }),
    });
    this.params.reporter.event("agent_run_completed", {
      ...(result.success ? {} : { severity: "error" }),
      payload: {
        run_id: input.run.id,
        role: input.run.role,
        status: result.success ? "completed" : "failed",
        provider_session_id: result.sessionId,
      },
    });
    await input.onViewEvent(taskViewEvents.toolProgress({
      provider: "agent-run-manager",
      title: `${input.run.role}: envelope persisted`,
      detail: envelope.summary,
      countAsTool: false,
    }));
    return { run: input.run, result, envelope, ...persisted };
  }

  private persistEnvelope(run: AgentRun, envelope: ManagedChildEnvelope): { messages: AgentMessage[]; artifactIds: string[] } {
    const artifactIds = envelope.artifacts.map((artifact) =>
      this.bus.publishArtifact({
        taskId: this.params.taskId,
        runId: run.id,
        kind: artifact.kind,
        cwd: this.params.cwd,
        ...(artifact.title ? { title: artifact.title } : {}),
        ...(artifact.summary ? { summary: artifact.summary } : {}),
        ...(artifact.content !== undefined ? { content: artifact.content } : {}),
        ...(artifact.path ? { path: artifact.path } : {}),
      }).id
    );
    const messages = envelope.messages.map((message) => this.persistEnvelopeMessage(run, message, artifactIds));

    if (!messages.length && (envelope.summary || envelope.verdict || artifactIds.length)) {
      messages.push(this.persistEnvelopeMessage(run, {
        kind: this.defaultMessageKind(run.role, envelope),
        content_text: envelope.summary ?? envelope.verdict ?? "managed child envelope",
        payload_json: {
          ...(envelope.verdict ? { verdict: envelope.verdict } : {}),
          ...(envelope.fix_list?.length ? { fix_list: envelope.fix_list } : {}),
        },
        artifact_ids: artifactIds,
      }, artifactIds));
    }

    const sourceMessage = messages.at(-1);
    if (sourceMessage) {
      for (const fact of envelope.blackboard_facts) {
        this.bus.upsertBlackboardFact({
          taskId: this.params.taskId,
          key: fact.key,
          content: fact.content,
          confidence: fact.confidence,
          sourceMessageId: sourceMessage.id,
          ...(fact.status ? { status: fact.status } : {}),
        });
        this.params.reporter.event("blackboard_fact_upserted", {
          payload: {
            run_id: run.id,
            key: fact.key,
            source_message_id: sourceMessage.id,
            confidence: fact.confidence,
            status: fact.status ?? "active",
          },
        });
      }
    }
    for (const artifactId of artifactIds) {
      this.params.reporter.event("artifact_written", {
        payload: { artifact_id: artifactId, run_id: run.id },
      });
    }
    return { messages, artifactIds };
  }

  private persistEnvelopeMessage(run: AgentRun, message: ManagedEnvelopeMessage, fallbackArtifactIds: string[]): AgentMessage {
    const toRunId = message.to_run_id ?? (message.to_role ? this.findRunByRole(message.to_role)?.id : undefined);
    const persisted = this.bus.sendMessage({
      taskId: this.params.taskId,
      fromRunId: run.id,
      ...(toRunId ? { toRunId } : {}),
      kind: message.kind,
      ...(message.content_text ? { contentText: message.content_text } : {}),
      ...(message.payload_json !== undefined ? { payload: message.payload_json } : {}),
      artifactIds: message.artifact_ids?.length ? message.artifact_ids : fallbackArtifactIds,
      ...(message.causal_message_id ? { causalMessageId: message.causal_message_id } : {}),
    });
    this.params.reporter.event("agent_message_posted", {
      payload: {
        message_id: persisted.id,
        from_run_id: run.id,
        ...(persisted.to_run_id ? { to_run_id: persisted.to_run_id } : {}),
        kind: persisted.kind,
      },
    });
    return persisted;
  }

  private recordFinalVerdict(evaluator: AgentRun, root: AgentRun, verdict: ManagedRunVerdict, fixList: string[]): void {
    const message = this.bus.sendMessage({
      taskId: this.params.taskId,
      fromRunId: evaluator.id,
      toRunId: root.id,
      kind: "verdict",
      contentText: verdict,
      payload: { verdict, fix_list: fixList },
    });
    this.params.reporter.event("verdict_received", {
      ...(verdict === "FAIL" ? { severity: "warning" } : {}),
      payload: { message_id: message.id, from_run_id: evaluator.id, verdict },
    });
    this.bus.upsertBlackboardFact({
      taskId: this.params.taskId,
      key: "final_verdict",
      content: verdict,
      sourceMessageId: message.id,
      confidence: "high",
    });
  }

  private defaultMessageKind(role: string, envelope: ManagedChildEnvelope): AgentMessageKind {
    if (envelope.verdict || role === "evaluator") return "verdict";
    if (role === "planner") return "handoff";
    if (role === "generator") return envelope.artifacts.length ? "artifact" : "finding";
    return "finding";
  }

  private inferVerdict(turn: ManagedChildTurn): ManagedRunVerdict {
    const text = `${turn.envelope.summary ?? ""}\n${turn.result.result}`.toUpperCase();
    return text.includes("FAIL") ? "FAIL" : "PASS";
  }

  private findRunByRole(role: string): AgentRun | undefined {
    return listRunsForTask(this.params.taskId).find((run) => run.role === role);
  }

  private buildChildPrompt(input: {
    role: string;
    taskPrompt: string;
    instruction: string;
    extra?: Record<string, unknown>;
  }): string {
    const roster = this.bus.listAgents(this.params.taskId).map((run) => ({
      run_id: run.id,
      role: run.role,
      can_send: run.can_send_kinds,
      can_receive: run.can_receive_kinds,
    }));
    const facts = this.bus.listBlackboard(this.params.taskId).map((fact) => ({
      key: fact.key,
      content: fact.content,
      confidence: fact.confidence,
    }));
    return [
      `MiniClaw Agent Run Manager child role: ${input.role}`,
      `Task brief:\n${input.taskPrompt}`,
      `Role instruction:\n${input.instruction}`,
      `Agent roster JSON:\n${JSON.stringify(roster, null, 2)}`,
      `Active blackboard JSON:\n${JSON.stringify(facts, null, 2)}`,
      input.extra ? `Extra context JSON:\n${JSON.stringify(input.extra, null, 2)}` : "",
      formatManagedEnvelopeInstruction(input.role),
    ].filter(Boolean).join("\n\n");
  }

  private progressLinesForTask(): string[] {
    return listRunsForTask(this.params.taskId)
      .filter((run) => run.role !== "supervisor")
      .map((run) => `${run.role}: ${run.status}`);
  }

  private synthesizeFinalResult(verdict: ManagedRunVerdict, summary: string): string {
    const facts = this.bus.listBlackboard(this.params.taskId);
    const factLines = facts.map((fact) => `- ${fact.key}: ${fact.content}`).join("\n");
    return [
      "Agent Run Manager managed run completed.",
      `Verdict: ${verdict}.`,
      summary ? `Summary: ${summary}` : "",
      factLines ? `Blackboard:\n${factLines}` : "",
    ].filter(Boolean).join("\n");
  }

  private failedResult(startedAt: number, sessionId: string, rootRunId: string, message: string): AgentTaskResult {
    updateRunStatus(rootRunId, "failed", { errorMessage: message });
    this.params.reporter.event("agent_run_completed", {
      severity: "error",
      payload: { run_id: rootRunId, role: "supervisor", status: "failed", reason: message },
    });
    return {
      success: false,
      sessionId,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      turns: 0,
      result: message,
      progressLines: this.progressLinesForTask(),
      toolCount: 0,
    };
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

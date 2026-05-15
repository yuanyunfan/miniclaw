import {
  updateRunStatus,
  upsertAgentSchedulerState,
  type AgentMessage,
  type AgentMessageKind,
  type AgentRun,
  type AgentSchedulerState,
  type AgentSchedulerStatus,
} from "../../store/agent-run-manager.js";
import type { TaskReporter } from "../task-reporter.js";
import type { AgentBus } from "./bus.js";

export const MANAGED_RUNTIME_SCHEDULER_VERSION = "managed-runtime-v1";

export interface ManagedSchedulerPlanNode {
  id: string;
  role: string;
  waits_for: AgentMessageKind[];
  after?: string[];
  repeatable?: boolean;
}

export const MANAGED_RUNTIME_SCHEDULER_PLAN: ManagedSchedulerPlanNode[] = [
  { id: "planner", role: "planner", waits_for: ["handoff"] },
  { id: "generator", role: "generator", waits_for: ["artifact", "finding"], after: ["planner"], repeatable: true },
  { id: "evaluator", role: "evaluator", waits_for: ["verdict"], after: ["generator"], repeatable: true },
];

export function createManagedSchedulerPlan(maxFixIterations: number): Record<string, unknown> {
  return {
    version: MANAGED_RUNTIME_SCHEDULER_VERSION,
    max_fix_iterations: maxFixIterations,
    nodes: MANAGED_RUNTIME_SCHEDULER_PLAN,
  };
}

export interface AgentRunSchedulerParams {
  taskId: string;
  rootRun: AgentRun;
  bus: AgentBus;
  reporter: TaskReporter;
  waitTimeoutMs: number;
  plan?: unknown;
}

export class AgentRunScheduler {
  private readonly plan: unknown;

  constructor(private readonly params: AgentRunSchedulerParams) {
    this.plan = params.plan ?? createManagedSchedulerPlan(0);
  }

  start(currentStep = "start"): AgentSchedulerState {
    return this.persist("running", currentStep);
  }

  running(currentStep: string, options: { lastMessageId?: string } = {}): AgentSchedulerState {
    updateRunStatus(this.params.rootRun.id, "running", { completedAt: null });
    return this.persist("running", currentStep, options);
  }

  complete(currentStep = "completed"): AgentSchedulerState {
    return this.persist("completed", currentStep);
  }

  fail(currentStep: string, message: string): AgentSchedulerState {
    return this.persist("failed", currentStep, { errorMessage: message });
  }

  cancel(reason: string): AgentSchedulerState {
    return this.persist("cancelled", "cancelled", { errorMessage: reason });
  }

  async yieldUntilChildEvent<T>(input: {
    currentStep: string;
    childRunId: string;
    waitKinds: AgentMessageKind[];
    signal: AbortSignal;
    runChild: () => Promise<T>;
    shouldWaitForResult?: (result: T) => boolean;
    ensureCompletionMessage?: (result: T) => void;
    timeoutMs?: number;
  }): Promise<{ result: T; wakeMessage?: AgentMessage }> {
    const waitController = new AbortController();
    const forwardAbort = () => waitController.abort(input.signal.reason);
    if (input.signal.aborted) forwardAbort();
    else input.signal.addEventListener("abort", forwardAbort, { once: true });

    updateRunStatus(this.params.rootRun.id, "waiting", { completedAt: null });
    this.persist("waiting", input.currentStep, {
      waitRunId: this.params.rootRun.id,
      waitKinds: input.waitKinds,
    });
    this.params.reporter.event("agent_scheduler_waiting", {
      payload: {
        root_run_id: this.params.rootRun.id,
        child_run_id: input.childRunId,
        current_step: input.currentStep,
        wait_kinds: input.waitKinds,
      },
    });

    const waitPromise = this.params.bus.waitForMessage({
      runId: this.params.rootRun.id,
      kinds: input.waitKinds,
      timeoutMs: input.timeoutMs ?? this.params.waitTimeoutMs,
      signal: waitController.signal,
    });
    waitPromise.catch(() => undefined);

    try {
      const result = await input.runChild();
      if (input.shouldWaitForResult && !input.shouldWaitForResult(result)) {
        waitController.abort(new Error("child result does not require scheduler wait"));
        waitPromise.catch(() => undefined);
        if (input.signal.aborted) this.cancel("scheduler wait aborted by root signal");
        else this.running(input.currentStep);
        return { result };
      }

      input.ensureCompletionMessage?.(result);
      const wakeMessage = await waitPromise;
      this.running(input.currentStep, { lastMessageId: wakeMessage.id });
      this.params.reporter.event("agent_scheduler_resumed", {
        payload: {
          root_run_id: this.params.rootRun.id,
          child_run_id: input.childRunId,
          current_step: input.currentStep,
          message_id: wakeMessage.id,
          kind: wakeMessage.kind,
        },
      });
      return { result, wakeMessage };
    } catch (err) {
      waitController.abort(err);
      waitPromise.catch(() => undefined);
      if (input.signal.aborted) this.cancel("scheduler wait aborted by root signal");
      else this.running(input.currentStep);
      throw err;
    } finally {
      input.signal.removeEventListener("abort", forwardAbort);
    }
  }

  private persist(
    status: AgentSchedulerStatus,
    currentStep: string,
    options: {
      waitRunId?: string;
      waitKinds?: AgentMessageKind[];
      lastMessageId?: string;
      errorMessage?: string;
    } = {},
  ): AgentSchedulerState {
    const state = upsertAgentSchedulerState({
      taskId: this.params.taskId,
      rootRunId: this.params.rootRun.id,
      schedulerVersion: MANAGED_RUNTIME_SCHEDULER_VERSION,
      status,
      currentStep,
      ...(options.waitRunId ? { waitRunId: options.waitRunId } : {}),
      ...(options.waitKinds ? { waitKinds: options.waitKinds } : {}),
      ...(options.lastMessageId ? { lastMessageId: options.lastMessageId } : {}),
      plan: this.plan,
    });
    this.params.reporter.event("agent_scheduler_state_changed", {
      ...(status === "failed" ? { severity: "error" } : {}),
      ...(status === "cancelled" ? { severity: "warning" } : {}),
      ...(options.errorMessage ? { message: options.errorMessage } : {}),
      payload: {
        root_run_id: this.params.rootRun.id,
        status,
        current_step: currentStep,
        ...(state.wait_run_id ? { wait_run_id: state.wait_run_id } : {}),
        ...(state.wait_kinds.length ? { wait_kinds: state.wait_kinds } : {}),
        ...(state.last_message_id ? { last_message_id: state.last_message_id } : {}),
      },
    });
    return state;
  }
}

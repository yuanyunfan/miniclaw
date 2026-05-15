import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  appendMessage,
  countMessagesForTask,
  getMessage,
  getRun,
  listActiveFacts,
  listArtifactsForRun,
  listRunsForTask,
  markMessageDelivered,
  readArtifact,
  readMailbox,
  upsertBlackboardFact,
  writeArtifact,
  type AgentArtifact,
  type AgentArtifactKind,
  type AgentMessage,
  type AgentMessageKind,
  type AgentRun,
  type BlackboardFact,
  type BlackboardFactConfidence,
  type BlackboardFactStatus,
} from "../../store/agent-run-manager.js";
import { DEFAULT_AGENT_RUN_MANAGER_POLICY } from "./policy.js";

interface Waiter {
  runId: string;
  kinds?: AgentMessageKind[];
  resolve: (message: AgentMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AgentBusMessageInput {
  taskId: string;
  fromRunId: string;
  toRunId?: string;
  kind: AgentMessageKind;
  contentText?: string;
  payload?: unknown;
  artifactIds?: string[];
  causalMessageId?: string;
}

export interface AgentBusWaitInput {
  runId: string;
  kinds?: AgentMessageKind[];
  afterCursor?: string;
  timeoutMs: number;
}

export interface AgentBusPolicy {
  maxMessages?: number;
  maxArtifactBytes?: number;
  maxPingPongTurns?: number;
}

function canUseKind(kinds: string[], kind: AgentMessageKind): boolean {
  return kinds.includes("*") || kinds.includes(kind);
}

function assertCanSend(from: AgentRun, kind: AgentMessageKind): void {
  if (!canUseKind(from.can_send_kinds, kind)) {
    throw new Error(`Agent run ${from.id} role=${from.role} cannot send ${kind}`);
  }
}

function assertCanReceive(to: AgentRun, kind: AgentMessageKind): void {
  if (!canUseKind(to.can_receive_kinds, kind)) {
    throw new Error(`Agent run ${to.id} role=${to.role} cannot receive ${kind}`);
  }
}

function matchesWaiter(waiter: Waiter, message: AgentMessage): boolean {
  if (message.to_run_id !== waiter.runId && message.to_run_id !== null) return false;
  return !waiter.kinds?.length || waiter.kinds.includes(message.kind);
}

function resolveArtifactBytes(input: { cwd: string; content?: string; path?: string }): number {
  if (input.content !== undefined) return Buffer.byteLength(input.content, "utf8");
  if (!input.path) return 0;
  const absolutePath = input.path.startsWith("/") ? input.path : resolve(input.cwd, input.path);
  return existsSync(absolutePath) ? statSync(absolutePath).size : 0;
}

export class AgentBus {
  private readonly waiters = new Set<Waiter>();
  private readonly policy: Required<AgentBusPolicy>;

  constructor(policy: AgentBusPolicy = {}) {
    this.policy = {
      maxMessages: policy.maxMessages ?? DEFAULT_AGENT_RUN_MANAGER_POLICY.maxMessages,
      maxArtifactBytes: policy.maxArtifactBytes ?? DEFAULT_AGENT_RUN_MANAGER_POLICY.maxArtifactBytes,
      maxPingPongTurns: policy.maxPingPongTurns ?? DEFAULT_AGENT_RUN_MANAGER_POLICY.maxPingPongTurns,
    };
  }

  listAgents(taskId: string): AgentRun[] {
    return listRunsForTask(taskId);
  }

  sendMessage(input: AgentBusMessageInput): AgentMessage {
    const messageCount = countMessagesForTask(input.taskId);
    if (messageCount >= this.policy.maxMessages) {
      throw new Error(`Agent Run Manager message limit exceeded for task ${input.taskId}: max_messages=${this.policy.maxMessages}`);
    }

    const from = getRun(input.fromRunId);
    if (!from) throw new Error(`Unknown sender agent run: ${input.fromRunId}`);
    if (from.task_id !== input.taskId) {
      throw new Error(`Sender run ${from.id} does not belong to task ${input.taskId}`);
    }
    assertCanSend(from, input.kind);

    if (input.toRunId) {
      const to = getRun(input.toRunId);
      if (!to) throw new Error(`Unknown target agent run: ${input.toRunId}`);
      if (to.task_id !== input.taskId) {
        throw new Error(`Target run ${to.id} does not belong to task ${input.taskId}`);
      }
      assertCanReceive(to, input.kind);
    }

    this.assertPingPongLimit(input.causalMessageId);
    const message = appendMessage(input);
    this.wakeWaiters(message);
    return message;
  }

  readMailbox(input: { runId: string; afterCursor?: string }): AgentMessage[] {
    return readMailbox({ ...input, includeDelivered: true });
  }

  async waitForMessage(input: AgentBusWaitInput): Promise<AgentMessage> {
    const existing = readMailbox({
      runId: input.runId,
      afterCursor: input.afterCursor,
      includeDelivered: false,
    }).find((message) => !input.kinds?.length || input.kinds.includes(message.kind));
    if (existing) {
      markMessageDelivered(existing.id);
      return existing;
    }

    return await new Promise<AgentMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for agent message run=${input.runId}`));
      }, input.timeoutMs);
      timer.unref?.();

      const waiter: Waiter = {
        runId: input.runId,
        kinds: input.kinds,
        resolve: (message) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          markMessageDelivered(message.id);
          resolve(message);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          reject(err);
        },
        timer,
      };
      this.waiters.add(waiter);
    });
  }

  publishArtifact(input: {
    taskId: string;
    runId: string;
    kind: AgentArtifactKind;
    cwd: string;
    title?: string;
    content?: string;
    path?: string;
    summary?: string;
  }): AgentArtifact {
    const run = getRun(input.runId);
    if (!run) throw new Error(`Unknown artifact owner agent run: ${input.runId}`);
    if (run.task_id !== input.taskId) {
      throw new Error(`Artifact owner ${run.id} does not belong to task ${input.taskId}`);
    }
    const artifactBytes = resolveArtifactBytes(input);
    if (artifactBytes > this.policy.maxArtifactBytes) {
      throw new Error(
        `Agent Run Manager artifact limit exceeded for task ${input.taskId}: bytes=${artifactBytes} max_artifact_bytes=${this.policy.maxArtifactBytes}`
      );
    }
    return writeArtifact(input);
  }

  readArtifact(artifactId: string, cwd: string): { artifact: AgentArtifact; content: string | null } | undefined {
    return readArtifact(artifactId, cwd);
  }

  listArtifacts(runId: string): AgentArtifact[] {
    return listArtifactsForRun(runId);
  }

  listBlackboard(taskId: string): BlackboardFact[] {
    return listActiveFacts(taskId);
  }

  upsertBlackboardFact(input: {
    taskId: string;
    key: string;
    content: string;
    sourceMessageId: string;
    confidence: BlackboardFactConfidence;
    status?: BlackboardFactStatus;
  }): BlackboardFact {
    return upsertBlackboardFact(input);
  }

  private wakeWaiters(message: AgentMessage): void {
    for (const waiter of [...this.waiters]) {
      if (matchesWaiter(waiter, message)) {
        waiter.resolve(message);
      }
    }
  }

  private assertPingPongLimit(causalMessageId: string | undefined): void {
    if (!causalMessageId || this.policy.maxPingPongTurns === 0) {
      if (causalMessageId && this.policy.maxPingPongTurns === 0) {
        throw new Error("Agent Run Manager ping-pong limit exceeded: max_ping_pong_turns=0");
      }
      return;
    }

    let depth = 0;
    let cursor: string | null | undefined = causalMessageId;
    while (cursor) {
      const message = getMessage(cursor);
      if (!message) break;
      depth += 1;
      if (depth + 1 > this.policy.maxPingPongTurns) {
        throw new Error(`Agent Run Manager ping-pong limit exceeded: max_ping_pong_turns=${this.policy.maxPingPongTurns}`);
      }
      cursor = message.causal_message_id;
    }
  }

  dispose(): void {
    for (const waiter of [...this.waiters]) {
      waiter.reject(new Error("Agent bus disposed"));
    }
  }
}

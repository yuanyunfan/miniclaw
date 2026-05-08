// Orchestrator: scene 生命周期 + agent 队列 + anti-loop / budget guards
//
// 设计：
// - Scene 是单进程内的可变状态对象（mutable）
// - 通过 EventEmitter 对外广播变化（UI 订阅）
// - speakNext() 是核心调度循环：从队列里取 persona → chatOnce → 入历史 → 解 mention 入队
// - 三层 cap：连续 same-speaker / total turns / total cost

import { EventEmitter } from "node:events";
import { v4 as uuid } from "uuid";
import { chatOnce } from "./agent.js";
import { parseMentions } from "./personas.js";
import { pickNextSpeaker } from "./stage-manager.js";
import { createScene as dbCreateScene, appendSceneMessage, updateSceneTotals } from "../store/db.js";
import { createLogger } from "../lib/log.js";
import type {
  AgentStatus,
  ChatOnceCallbacks,
  Persona,
  Scene,
  SceneMessage,
  SceneMode,
  ToolCallRecord,
} from "./types.js";

const log = createLogger("orchestrator");

const DEFAULT_BUDGET_CAP = Number(process.env.MINICLAW_STAGE_BUDGET_USD ?? "2");
const DEFAULT_TURN_CAP = Number(process.env.MINICLAW_STAGE_TURN_CAP ?? "30");
const SAME_SPEAKER_CAP = Number(process.env.MINICLAW_STAGE_SAME_SPEAKER_CAP ?? "3");

export interface OrchestratorEvents {
  message: (m: SceneMessage) => void;
  status: (personaId: string, status: AgentStatus) => void;
  text: (personaId: string, delta: string) => void;
  toolCall: (personaId: string, tc: ToolCallRecord) => void;
  totals: (totalCostUsd: number, totalTurns: number) => void;
  participants: (ids: string[]) => void;
  pause: (reason: string) => void;
  notice: (level: "info" | "warn" | "error", text: string) => void;
}

export class Orchestrator extends EventEmitter {
  scene: Scene;
  // 待发言的 persona 队列（FIFO）。可被 user 输入或 agent @ 引用插入
  private queue: string[] = [];
  // 正在运行的 chatOnce 标记（同时只允许一个 speaker —— MVP 简化）
  private running = false;
  // 是否被 paused（达到 cap 等触发）
  private paused = false;

  constructor(opts: {
    registry: Map<string, Persona>;
    mode?: SceneMode;
    budgetCapUsd?: number;
    turnCap?: number;
    sceneName?: string;
  }) {
    super();
    this.scene = {
      id: uuid(),
      ...(opts.sceneName ? { name: opts.sceneName } : {}),
      startedAt: Date.now(),
      participants: new Set(),
      registry: opts.registry,
      messages: [],
      totalCostUsd: 0,
      totalTurns: 0,
      mode: opts.mode ?? "manual",
      budgetCapUsd: opts.budgetCapUsd ?? DEFAULT_BUDGET_CAP,
      turnCap: opts.turnCap ?? DEFAULT_TURN_CAP,
      agentStatus: new Map(),
      abortControllers: new Map(),
    };
    dbCreateScene({ id: this.scene.id, mode: this.scene.mode, ...(opts.sceneName ? { name: opts.sceneName } : {}) });
    log.info(`scene ${this.scene.id.slice(0, 8)} created mode=${this.scene.mode}`);
  }

  // ===== 公开 API =====

  /** 召唤一个 persona 进场（必须已在 registry 注册） */
  summon(id: string): { ok: boolean; reason?: string } {
    const persona = this.scene.registry.get(id);
    if (!persona) return { ok: false, reason: `persona '${id}' 未在 registry 中注册` };
    if (this.scene.participants.has(id)) return { ok: false, reason: `${id} 已在场` };
    this.scene.participants.add(id);
    this.scene.agentStatus.set(id, "idle");
    this.emit("participants", [...this.scene.participants]);
    this.emit("notice", "info", `🎭 ${persona.name} ${persona.emoji} 上场`);
    return { ok: true };
  }

  /** 遣散一个 persona（中断 in-flight 调用） */
  dismiss(id: string): { ok: boolean; reason?: string } {
    if (!this.scene.participants.has(id)) return { ok: false, reason: `${id} 不在场` };
    const ctrl = this.scene.abortControllers.get(id);
    if (ctrl) ctrl.abort();
    this.scene.participants.delete(id);
    this.scene.agentStatus.delete(id);
    this.scene.abortControllers.delete(id);
    this.queue = this.queue.filter((q) => q !== id);
    this.emit("participants", [...this.scene.participants]);
    this.emit("notice", "info", `👋 ${id} 退场`);
    return { ok: true };
  }

  /** 用户发一条消息（可含 @mention 触发 routing） */
  userSay(text: string): void {
    const ts = Date.now();
    const mentions = parseMentions(text, this.scene.registry);
    const msg: SceneMessage = { ts, speaker: "user", content: text, mentions };
    this.scene.messages.push(msg);
    this.emit("message", msg);
    this.persistMessage(msg);
    this.paused = false;

    // 入队：若用户 @ 了在场 agent，加入队列（去重）；否则什么也不做（user 静默观察）
    for (const id of mentions) {
      if (this.scene.participants.has(id)) this.enqueue(id);
      else this.emit("notice", "warn", `@${id} 未在场，先 /summon ${id}`);
    }
    void this.tick();
  }

  /** 广播给所有在场 agent（每人独立 turn） */
  userBroadcast(text: string): void {
    const ts = Date.now();
    const msg: SceneMessage = { ts, speaker: "user", content: text };
    this.scene.messages.push(msg);
    this.emit("message", msg);
    this.persistMessage(msg);
    this.paused = false;
    for (const id of this.scene.participants) this.queue.push(id);
    void this.tick();
  }

  /** 中断当前发言 agent */
  abortCurrent(): void {
    for (const ctrl of this.scene.abortControllers.values()) ctrl.abort();
    this.emit("notice", "warn", "🛑 已中断当前发言");
  }

  /** 切换 mode（auto 模式由 stage-manager 接管 next_speaker，这里仅记录） */
  setMode(mode: SceneMode): void {
    this.scene.mode = mode;
    this.emit("notice", "info", `mode → ${mode}`);
  }

  setBudgetCap(usd: number): void {
    this.scene.budgetCapUsd = usd;
  }

  /** 主动塞一个发言者到队首（auto 模式下 stage-manager 用） */
  enqueueNext(id: string): void {
    if (!this.scene.participants.has(id)) return;
    if (this.queue.includes(id)) return;
    this.queue.unshift(id);
    void this.tick();
  }

  /** 入队尾，去重（同一 id 已在队列内则跳过） */
  private enqueue(id: string): void {
    if (this.queue.includes(id)) return;
    this.queue.push(id);
  }

  // ===== 内部调度 =====

  private async tick(): Promise<void> {
    if (this.running || this.paused) return;

    // auto 模式：队列空时调 stage-manager 决策
    if (!this.queue.length && this.scene.mode === "auto") {
      const lastSpeaker = this.scene.messages.length
        ? this.scene.messages[this.scene.messages.length - 1].speaker
        : null;
      // 只有最后是 agent（不是 user）时才自动续；user 刚说完就轮到 agent，但已经走 userSay 入队
      if (lastSpeaker && lastSpeaker !== "user") {
        await this.runStageManager();
      }
    }

    if (!this.queue.length) return;

    // Anti-loop: 同 speaker 连续 N 次（不含 user 插入）→ 暂停
    const lastN = this.scene.messages.slice(-SAME_SPEAKER_CAP).map((m) => m.speaker);
    if (
      lastN.length === SAME_SPEAKER_CAP &&
      lastN.every((s) => s === lastN[0]) &&
      lastN[0] !== "user" &&
      this.queue[0] === lastN[0]
    ) {
      this.pauseScene(`${lastN[0]} 连续 ${SAME_SPEAKER_CAP} 轮未停，已暂停。/abort 或用户输入恢复`);
      return;
    }

    // Turn cap
    if (this.scene.totalTurns >= this.scene.turnCap) {
      this.pauseScene(`已达 turn cap (${this.scene.turnCap})，请用户介入`);
      return;
    }

    // Budget cap (hard)
    if (this.scene.totalCostUsd >= this.scene.budgetCapUsd) {
      this.pauseScene(`已达 budget cap ($${this.scene.budgetCapUsd})，强制中止`);
      this.queue = [];
      return;
    }

    const id = this.queue.shift()!;
    if (!this.scene.participants.has(id)) {
      void this.tick();
      return;
    }
    const persona = this.scene.registry.get(id)!;
    await this.runAgent(persona);
    void this.tick();
  }

  private async runAgent(persona: Persona): Promise<void> {
    this.running = true;
    const ctrl = new AbortController();
    this.scene.abortControllers.set(persona.id, ctrl);
    this.setStatus(persona.id, "thinking");

    const cb: ChatOnceCallbacks = {
      onText: (delta) => this.emit("text", persona.id, delta),
      onToolCall: (tc) => this.emit("toolCall", persona.id, tc),
      onStatus: (s) => this.setStatus(persona.id, s),
    };

    try {
      const result = await chatOnce(persona, this.scene.messages, cb, ctrl.signal);
      const ts = Date.now();
      // 重新解析 mentions：受限于 registry（chatOnce 只过滤自指）
      const validMentions = result.mentions.filter((m) => this.scene.registry.has(m));
      const msg: SceneMessage = {
        ts,
        speaker: persona.id,
        content: result.content,
        mentions: validMentions,
        toolCalls: result.toolCalls,
        costUsd: result.costUsd,
        iters: result.iters,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
      this.scene.messages.push(msg);
      this.scene.totalCostUsd += result.costUsd;
      this.scene.totalTurns += 1;
      this.emit("message", msg);
      this.emit("totals", this.scene.totalCostUsd, this.scene.totalTurns);
      this.persistMessage(msg);
      updateSceneTotals(this.scene.id, {
        total_cost_usd: this.scene.totalCostUsd,
        total_turns: this.scene.totalTurns,
      });

      // 入队后续 mention（仅在场的，去重）
      for (const next of validMentions) {
        if (this.scene.participants.has(next) && next !== persona.id) {
          this.enqueue(next);
        } else if (!this.scene.participants.has(next)) {
          this.emit("notice", "warn", `${persona.id} @${next} 但未在场，已忽略`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit("notice", "error", `${persona.id} 调用失败: ${msg}`);
      log.error(`${persona.id} runAgent error:`, err);
    } finally {
      this.scene.abortControllers.delete(persona.id);
      this.setStatus(persona.id, "idle");
      this.running = false;
    }
  }

  private setStatus(id: string, status: AgentStatus): void {
    this.scene.agentStatus.set(id, status);
    this.emit("status", id, status);
  }

  /** auto 模式下调 stage-manager LLM 决策下一发言者 */
  private async runStageManager(): Promise<void> {
    if (!this.scene.participants.size) return;
    const participants = [...this.scene.participants]
      .map((id) => this.scene.registry.get(id))
      .filter((p): p is Persona => !!p);

    try {
      const decision = await pickNextSpeaker(participants, this.scene.messages);
      this.scene.totalCostUsd += decision.costUsd;
      updateSceneTotals(this.scene.id, { total_cost_usd: this.scene.totalCostUsd });

      if (decision.next === "end") {
        this.emit("notice", "info", `🎬 stage-manager 宣布场景结束（${decision.reason}）`);
        this.scene.endedAt = Date.now();
        return;
      }
      if (decision.next === "user") {
        this.pauseScene(`stage-manager 把发言权交给用户：${decision.reason}`);
        return;
      }
      // 同 speaker 连续 2 turn 防护
      const lastSpeaker = this.scene.messages.length
        ? this.scene.messages[this.scene.messages.length - 1].speaker
        : null;
      if (lastSpeaker === decision.next) {
        // 强制找另一个在场 agent
        const others = [...this.scene.participants].filter((id) => id !== decision.next);
        if (!others.length) {
          this.pauseScene(`auto 卡住：只有 ${decision.next} 在场，等用户介入`);
          return;
        }
        const alt = others[0];
        this.emit("notice", "warn", `🎬 stage-manager 想让 ${decision.next} 继续，被强制切到 ${alt}`);
        this.enqueue(alt);
      } else {
        this.emit("notice", "info", `🎬 stage-manager → @${decision.next}（${decision.reason}）`);
        this.enqueue(decision.next);
      }
    } catch (err) {
      this.emit("notice", "error", `stage-manager 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private pauseScene(reason: string): void {
    this.paused = true;
    this.emit("pause", reason);
    this.emit("notice", "warn", `⏸ ${reason}`);
  }

  private persistMessage(m: SceneMessage): void {
    appendSceneMessage({
      scene_id: this.scene.id,
      ts: new Date(m.ts).toISOString(),
      speaker: m.speaker,
      ...(m.content ? { content: m.content } : {}),
      ...(m.toolCalls?.length ? { tool_calls_json: JSON.stringify(m.toolCalls) } : {}),
      ...(typeof m.costUsd === "number" ? { cost_usd: m.costUsd } : {}),
    });
  }
}

export const __testables = { DEFAULT_BUDGET_CAP, DEFAULT_TURN_CAP, SAME_SPEAKER_CAP };

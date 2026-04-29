// 单 mutable store + Ink useStore hook
// 不引入 zustand 等额外库 —— Ink 重渲染靠 forceUpdate 触发即可

import { useEffect, useReducer, useRef } from "react";
import { EventEmitter } from "node:events";
import type { Orchestrator } from "../orchestrator.js";
import type { AgentStatus, SceneMessage, ToolCallRecord } from "../types.js";

export interface UIState {
  participants: string[];
  agentStatus: Map<string, AgentStatus>;
  messages: SceneMessage[];
  // 当前正在 streaming 的 buffer（key = personaId）
  streamingBuffers: Map<string, string>;
  totalCostUsd: number;
  totalTurns: number;
  budgetCapUsd: number;
  turnCap: number;
  mode: "manual" | "auto";
  notices: Array<{ ts: number; level: "info" | "warn" | "error"; text: string }>;
  pauseReason: string | null;
  activeSpeaker: string | null;
}

const NOTICE_LIMIT = 30;

class StoreImpl extends EventEmitter {
  state: UIState;
  orch: Orchestrator;

  constructor(orch: Orchestrator) {
    super();
    this.orch = orch;
    this.state = {
      participants: [...orch.scene.participants],
      agentStatus: new Map(orch.scene.agentStatus),
      messages: [...orch.scene.messages],
      streamingBuffers: new Map(),
      totalCostUsd: orch.scene.totalCostUsd,
      totalTurns: orch.scene.totalTurns,
      budgetCapUsd: orch.scene.budgetCapUsd,
      turnCap: orch.scene.turnCap,
      mode: orch.scene.mode,
      notices: [],
      pauseReason: null,
      activeSpeaker: null,
    };
    this.wire();
  }

  private wire(): void {
    this.orch.on("participants", (ids) => {
      this.state.participants = ids;
      this.bump();
    });
    this.orch.on("status", (id, status) => {
      this.state.agentStatus.set(id, status);
      if (status === "thinking" || status === "speaking" || status === "tool-call") {
        this.state.activeSpeaker = id;
      } else if (status === "idle" || status === "done" || status === "aborted") {
        if (this.state.activeSpeaker === id) this.state.activeSpeaker = null;
        // 清掉 streaming buffer（消息已落到 messages）
        this.state.streamingBuffers.delete(id);
      }
      this.bump();
    });
    this.orch.on("text", (id, delta) => {
      const cur = this.state.streamingBuffers.get(id) ?? "";
      this.state.streamingBuffers.set(id, cur + delta);
      this.bump();
    });
    this.orch.on("toolCall", (id, tc) => {
      // 把 tool call 临时挂到 streaming buffer 末尾，让 stream 看到
      const cur = this.state.streamingBuffers.get(id) ?? "";
      this.state.streamingBuffers.set(id, cur + `\n  🔧 ${tc.name} ${truncJson(tc.input)}`);
      this.bump();
    });
    this.orch.on("message", (m) => {
      this.state.messages = [...this.state.messages, m];
      // 消息落定后清 streaming buffer
      if (m.speaker !== "user") this.state.streamingBuffers.delete(m.speaker);
      this.bump();
    });
    this.orch.on("totals", (cost, turns) => {
      this.state.totalCostUsd = cost;
      this.state.totalTurns = turns;
      this.bump();
    });
    this.orch.on("notice", (level, text) => {
      this.state.notices = [
        ...this.state.notices.slice(-(NOTICE_LIMIT - 1)),
        { ts: Date.now(), level, text },
      ];
      this.bump();
    });
    this.orch.on("pause", (reason) => {
      this.state.pauseReason = reason;
      this.bump();
    });
  }

  refreshFromOrch(): void {
    // /load 后调用，整体替换
    this.state = {
      ...this.state,
      participants: [...this.orch.scene.participants],
      agentStatus: new Map(this.orch.scene.agentStatus),
      messages: [...this.orch.scene.messages],
      totalCostUsd: this.orch.scene.totalCostUsd,
      totalTurns: this.orch.scene.totalTurns,
      mode: this.orch.scene.mode,
      pauseReason: null,
    };
    this.bump();
  }

  setMode(mode: "manual" | "auto"): void {
    this.state.mode = mode;
    this.bump();
  }

  pushNotice(level: "info" | "warn" | "error", text: string): void {
    this.state.notices = [
      ...this.state.notices.slice(-(NOTICE_LIMIT - 1)),
      { ts: Date.now(), level, text },
    ];
    this.bump();
  }

  private bump(): void {
    this.emit("change");
  }
}

export type Store = StoreImpl;

export function createStore(orch: Orchestrator): Store {
  return new StoreImpl(orch);
}

/** Hook: 把 store 状态绑到组件，每次 store change 触发重渲染 */
export function useStore(store: Store): UIState {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const stateRef = useRef(store.state);
  useEffect(() => {
    const handler = () => {
      stateRef.current = store.state;
      force();
    };
    store.on("change", handler);
    return () => {
      store.off("change", handler);
    };
  }, [store]);
  return store.state;
}

function truncJson(input: unknown, max = 60): string {
  let s: string;
  try {
    s = JSON.stringify(input);
  } catch {
    s = String(input);
  }
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export const __testables = { truncJson };
export type { ToolCallRecord };

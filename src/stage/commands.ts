// Slash 命令解析与 dispatcher
// 与 Orchestrator 解耦：commands.ts 只把字符串变成 Action，由 caller 决定执行

import type { Orchestrator } from "./orchestrator.js";

export type CommandAction =
  | { kind: "say"; text: string }              // 普通文本（含可能的 @）
  | { kind: "summon"; ids: string[] }
  | { kind: "dismiss"; id: string }
  | { kind: "broadcast"; text: string }        // /all
  | { kind: "abort" }
  | { kind: "mode"; mode: "auto" | "manual" }
  | { kind: "save"; name?: string }
  | { kind: "load"; name: string }
  | { kind: "roster" }
  | { kind: "cost" }
  | { kind: "clear" }
  | { kind: "quit" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string; reason: string };

export function parseCommand(raw: string): CommandAction {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "unknown", raw, reason: "空输入" };

  if (!trimmed.startsWith("/")) {
    return { kind: "say", text: trimmed };
  }

  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const args = rest.join(" ").trim();
  const cmd = head.toLowerCase();

  switch (cmd) {
    case "summon": {
      const ids = rest.map((s) => s.toLowerCase()).filter(Boolean);
      if (!ids.length) return { kind: "unknown", raw, reason: "/summon 需要至少一个 persona id" };
      return { kind: "summon", ids };
    }
    case "dismiss": {
      const id = (rest[0] ?? "").toLowerCase();
      if (!id) return { kind: "unknown", raw, reason: "/dismiss 需要 persona id" };
      return { kind: "dismiss", id };
    }
    case "say": {
      // /say @x msg  等价于直接输入 "@x msg"
      if (!args) return { kind: "unknown", raw, reason: "/say 需要内容" };
      return { kind: "say", text: args };
    }
    case "all":
    case "broadcast": {
      if (!args) return { kind: "unknown", raw, reason: `/${cmd} 需要内容` };
      return { kind: "broadcast", text: args };
    }
    case "abort":
    case "stop":
      return { kind: "abort" };
    case "auto":
      return { kind: "mode", mode: "auto" };
    case "manual":
      return { kind: "mode", mode: "manual" };
    case "save":
      return rest[0] ? { kind: "save", name: rest[0] } : { kind: "save" };
    case "load": {
      const name = rest[0];
      if (!name) return { kind: "unknown", raw, reason: "/load 需要 scene 名" };
      return { kind: "load", name };
    }
    case "roster":
    case "ls":
      return { kind: "roster" };
    case "cost":
      return { kind: "cost" };
    case "clear":
      return { kind: "clear" };
    case "q":
    case "quit":
    case "exit":
      return { kind: "quit" };
    case "help":
    case "?":
      return { kind: "help" };
    default:
      return { kind: "unknown", raw, reason: `未知命令 /${cmd}` };
  }
}

export function helpText(): string {
  return [
    "命令清单：",
    "  /summon <id> [id2...]      召唤 persona 到 scene",
    "  /dismiss <id>              遣散 agent",
    "  /say @<id> <msg>           等价直接输入 @<id> <msg>",
    "  /all <msg>                 广播给所有在场",
    "  /abort                     中断当前发言",
    "  /auto | /manual            切换 turn-taking 模式",
    "  /save [name]               保存 scene",
    "  /load <name>               恢复 scene",
    "  /roster                    查看 personas",
    "  /cost                      当前 scene 花费",
    "  /clear                     重置 scene",
    "  /q                         退出",
    "  /help                      本说明",
  ].join("\n");
}

/** 把 action 应用到 orchestrator；返回需要 caller 处理的副作用（如 quit/save/load） */
export function applyCommand(action: CommandAction, orch: Orchestrator):
  | { kind: "ok"; text?: string }
  | { kind: "quit" }
  | { kind: "save"; name?: string }
  | { kind: "load"; name: string }
  | { kind: "error"; text: string } {
  switch (action.kind) {
    case "say":
      orch.userSay(action.text);
      return { kind: "ok" };
    case "broadcast":
      orch.userBroadcast(action.text);
      return { kind: "ok" };
    case "summon": {
      const failed: string[] = [];
      for (const id of action.ids) {
        const r = orch.summon(id);
        if (!r.ok) failed.push(`${id}: ${r.reason}`);
      }
      if (failed.length) return { kind: "error", text: failed.join("; ") };
      return { kind: "ok" };
    }
    case "dismiss": {
      const r = orch.dismiss(action.id);
      return r.ok ? { kind: "ok" } : { kind: "error", text: r.reason ?? "失败" };
    }
    case "abort":
      orch.abortCurrent();
      return { kind: "ok" };
    case "mode":
      orch.setMode(action.mode);
      return { kind: "ok" };
    case "save":
      return action.name !== undefined ? { kind: "save", name: action.name } : { kind: "save" };
    case "load":
      return { kind: "load", name: action.name };
    case "roster": {
      const lines: string[] = ["注册的 personas："];
      for (const [id, p] of orch.scene.registry) {
        const inScene = orch.scene.participants.has(id) ? "● 在场" : "○ 待召唤";
        lines.push(`  ${p.emoji} ${id.padEnd(12)} ${inScene}`);
      }
      return { kind: "ok", text: lines.join("\n") };
    }
    case "cost": {
      const lines: string[] = [
        `Scene ${orch.scene.id.slice(0, 8)} | 总花费 $${orch.scene.totalCostUsd.toFixed(4)} / cap $${orch.scene.budgetCapUsd}`,
        `总 turns ${orch.scene.totalTurns} / cap ${orch.scene.turnCap}`,
      ];
      const perAgent = new Map<string, number>();
      for (const m of orch.scene.messages) {
        if (m.speaker !== "user" && typeof m.costUsd === "number") {
          perAgent.set(m.speaker, (perAgent.get(m.speaker) ?? 0) + m.costUsd);
        }
      }
      for (const [id, cost] of perAgent) {
        lines.push(`  ${id.padEnd(12)} $${cost.toFixed(4)}`);
      }
      return { kind: "ok", text: lines.join("\n") };
    }
    case "clear":
      orch.scene.messages = [];
      orch.scene.totalCostUsd = 0;
      orch.scene.totalTurns = 0;
      return { kind: "ok", text: "scene 已重置（保留 personas）" };
    case "quit":
      return { kind: "quit" };
    case "help":
      return { kind: "ok", text: helpText() };
    case "unknown":
      return { kind: "error", text: action.reason };
  }
}

// Scene 持久化：双轨模式
// 1. SQLite scenes/scene_messages 表（结构化，给 /load 用）
// 2. ~/.miniclaw/scenes/<id>.md transcript（可读，可 vim 看）
//
// /save [name] —— 把当前 scene 写一份 transcript md 并把 name 回写 scenes 表
// /load <name> —— 按 name 找 scene_id，从 DB 取 messages 重建 Scene 状态
//
// 注意：load 不能恢复 abortControllers；participants 从最后的消息推断（凡 speaker 都视为在场）

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getScene,
  getSceneByName,
  getSceneMessages,
  updateSceneTotals,
} from "../store/db.js";
import { createLogger } from "../lib/log.js";
import type { Orchestrator } from "./orchestrator.js";
import type { Persona, SceneMessage, ToolCallRecord } from "./types.js";

const log = createLogger("scene-store");

const SCENES_DIR = join(homedir(), ".miniclaw", "scenes");

function ensureDir(): string {
  if (!existsSync(SCENES_DIR)) mkdirSync(SCENES_DIR, { recursive: true });
  return SCENES_DIR;
}

/** /save 当前 scene → transcript md + DB name + totals */
export function saveScene(orch: Orchestrator, name?: string): { path: string; name: string } {
  ensureDir();
  const finalName = name ?? `scene-${orch.scene.id.slice(0, 8)}`;
  const path = join(SCENES_DIR, `${finalName}.md`);
  writeFileSync(path, renderTranscript(orch.scene.id, orch.scene.messages, orch.scene.registry, orch.scene));
  updateSceneTotals(orch.scene.id, {
    name: finalName,
    total_cost_usd: orch.scene.totalCostUsd,
    total_turns: orch.scene.totalTurns,
  });
  log.info(`scene ${orch.scene.id.slice(0, 8)} saved as '${finalName}' → ${path}`);
  return { path, name: finalName };
}

/** /load 按 name 找最近的 scene 重建 messages + participants */
export function loadScene(orch: Orchestrator, name: string): { ok: boolean; reason?: string; messageCount?: number } {
  const row = getSceneByName(name) ?? getScene(name);
  if (!row) return { ok: false, reason: `scene '${name}' 不存在` };
  const msgRows = getSceneMessages(row.id);
  if (!msgRows.length) return { ok: false, reason: `scene '${name}' 无消息` };

  // 重建 messages
  const messages: SceneMessage[] = msgRows.map((r) => {
    const ts = Date.parse(r.ts.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(r.ts) ? r.ts : r.ts + "Z");
    let toolCalls: ToolCallRecord[] | undefined;
    if (r.tool_calls_json) {
      try { toolCalls = JSON.parse(r.tool_calls_json); } catch { /* ignore */ }
    }
    return {
      ts: Number.isFinite(ts) ? ts : Date.now(),
      speaker: r.speaker,
      content: r.content ?? "",
      ...(toolCalls && toolCalls.length ? { toolCalls } : {}),
      ...(typeof r.cost_usd === "number" ? { costUsd: r.cost_usd } : {}),
    };
  });

  // 推断 participants：消息里出现的 non-user speaker 且 registry 有
  const inferred = new Set<string>();
  for (const m of messages) {
    if (m.speaker !== "user" && orch.scene.registry.has(m.speaker)) inferred.add(m.speaker);
  }

  // 替换 scene 内核（保留 id 不变？这里 load 视为接管，沿用旧 scene_id 续写）
  orch.scene.id = row.id;
  if (row.name) orch.scene.name = row.name;
  orch.scene.messages = messages;
  orch.scene.totalCostUsd = row.total_cost_usd ?? 0;
  orch.scene.totalTurns = row.total_turns ?? 0;
  orch.scene.participants = inferred;
  orch.scene.agentStatus.clear();
  orch.scene.abortControllers.clear();
  for (const id of inferred) orch.scene.agentStatus.set(id, "idle");

  log.info(`scene '${name}' loaded: ${messages.length} msgs, participants=${[...inferred].join(", ")}`);
  return { ok: true, messageCount: messages.length };
}

function renderTranscript(
  sceneId: string,
  messages: SceneMessage[],
  registry: Map<string, Persona>,
  scene: { totalCostUsd: number; totalTurns: number; mode: string },
): string {
  const lines: string[] = [];
  lines.push(`# MiniClaw Stage Scene`);
  lines.push("");
  lines.push(`- **scene_id**: \`${sceneId}\``);
  lines.push(`- **mode**: ${scene.mode}`);
  lines.push(`- **turns**: ${scene.totalTurns}`);
  lines.push(`- **cost**: $${scene.totalCostUsd.toFixed(4)}`);
  lines.push(`- **saved_at**: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const m of messages) {
    const ts = new Date(m.ts).toISOString().slice(11, 19); // HH:MM:SS
    const persona = m.speaker === "user" ? null : registry.get(m.speaker);
    const tag = persona ? `${persona.emoji} **${persona.name}**` : `**${m.speaker}**`;
    lines.push(`### [${ts}] ${tag}`);
    lines.push("");
    if (m.content) {
      lines.push(m.content);
      lines.push("");
    }
    if (m.toolCalls?.length) {
      lines.push("> 工具调用：");
      for (const tc of m.toolCalls) {
        const inputStr = JSON.stringify(tc.input).slice(0, 120);
        lines.push(`> - \`${tc.name}\`(${inputStr}) ${tc.isError ? "❌" : "✓"}`);
      }
      lines.push("");
    }
    if (typeof m.costUsd === "number") {
      lines.push(`<sub>cost: $${m.costUsd.toFixed(4)} · iters: ${m.iters ?? "-"} · in:${m.inputTokens ?? "-"} out:${m.outputTokens ?? "-"}</sub>`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export const __testables = { renderTranscript };

// Phase 1 smoke test: 不走 UI，直接调 chatOnce 验证 round-trip
//
// 用法：
//   npx tsx src/stage/smoke.ts            # 默认让 CEO 回应一个简单需求
//   npx tsx src/stage/smoke.ts engineer "解释下 Promise.all 的失败传播"
//
// 输出：完整 transcript + token/cost 摘要 + DB 写入验证

import { initDb, createScene, appendSceneMessage, getScene, getSceneMessages } from "../store/db.js";
import { loadPersonas } from "./personas.js";
import { chatOnce } from "./agent.js";
import { v4 as uuid } from "uuid";

async function main() {
  initDb();
  const { byId, errors } = loadPersonas();
  if (errors.length) {
    console.error("[smoke] persona errors:", errors);
    process.exit(1);
  }

  const personaId = (process.argv[2] || "ceo").toLowerCase();
  const userPrompt = process.argv[3] || "我想做一个登录页，简单需求，给个粗略思路然后 @ 一个合适的 agent 接力";

  const persona = byId.get(personaId);
  if (!persona) {
    console.error(`[smoke] persona '${personaId}' 不存在。可用：${[...byId.keys()].join(", ")}`);
    process.exit(1);
  }

  const sceneId = uuid();
  createScene({ id: sceneId, name: "smoke", mode: "manual" });
  console.log(`\n=== Scene ${sceneId.slice(0, 8)} | persona=${persona.name} ${persona.emoji} ===\n`);

  // user 第一条
  const ts = new Date().toISOString();
  appendSceneMessage({ scene_id: sceneId, ts, speaker: "user", content: userPrompt });
  console.log(`[user] ${userPrompt}\n`);

  // 调 agent
  console.log(`[${persona.name}] (thinking...)\n`);
  const result = await chatOnce(persona, [{ ts: Date.now(), speaker: "user", content: userPrompt }], {
    onText: (t) => process.stdout.write(t),
    onToolCall: (tc) => console.log(`\n  🔧 ${tc.name} → ${(tc.result ?? "").slice(0, 80)}`),
  });

  console.log("\n");

  // 写回 DB
  appendSceneMessage({
    scene_id: sceneId,
    ts: new Date().toISOString(),
    speaker: persona.id,
    content: result.content,
    tool_calls_json: JSON.stringify(result.toolCalls),
    cost_usd: result.costUsd,
  });

  console.log(`\n=== Result ===`);
  console.log(`mentions: ${result.mentions.length ? result.mentions.join(", ") : "(none)"}`);
  console.log(`tool calls: ${result.toolCalls.length}`);
  console.log(`iters: ${result.iters}`);
  console.log(`tokens: in=${result.inputTokens} out=${result.outputTokens} cacheR=${result.cacheReadTokens}`);
  console.log(`cost: $${result.costUsd.toFixed(4)}`);
  console.log(`aborted: ${result.aborted}`);

  // 校验 DB 持久化
  const scene = getScene(sceneId);
  const msgs = getSceneMessages(sceneId);
  console.log(`\n=== DB Verification ===`);
  console.log(`scene row: ${scene ? "✓" : "✗"}  msg count: ${msgs.length}`);
  console.log(`speakers: ${msgs.map((m) => m.speaker).join(" → ")}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(1);
});

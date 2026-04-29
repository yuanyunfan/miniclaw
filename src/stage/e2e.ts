// 非交互 E2E 驱动：模拟用户在 TUI 输入，跑真 LLM，验证 routing 是否符合预期
//
// 用法: npx tsx src/stage/e2e.ts "@ceo 拉一下 MSFT 股价并简评"
//
// 不渲染 TUI，但订阅所有 orchestrator 事件并按时间打印
// 等队列排空（无 active + 队列空）后退出，输出 summary

import { initDb } from "../store/db.js";
import { loadPersonas } from "./personas.js";
import { Orchestrator } from "./orchestrator.js";

async function main() {
  initDb();
  const { byId, errors } = loadPersonas();
  if (errors.length) {
    console.error("[e2e] persona errors:", errors);
    process.exit(1);
  }

  const userInput = process.argv[2] || "@ceo 拉一下 MSFT 股价并简评";
  const summonList = (process.argv[3] || "ceo,engineer,tester").split(",");

  const orch = new Orchestrator({ registry: byId });

  console.log(`\n=== Stage E2E ===`);
  console.log(`scene: ${orch.scene.id.slice(0, 8)}  mode: ${orch.scene.mode}`);
  console.log(`budget cap: $${orch.scene.budgetCapUsd}  turn cap: ${orch.scene.turnCap}\n`);

  // 召唤
  for (const id of summonList) {
    const r = orch.summon(id.trim());
    console.log(`/summon ${id.trim()} → ${r.ok ? "✓" : "✗ " + r.reason}`);
  }
  console.log("");

  // 订阅事件
  const startedAt = Date.now();
  orch.on("status", (id, status) => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[${elapsed}s] [status] ${id} → ${status}`);
  });
  orch.on("toolCall", (id, tc) => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const inputStr = JSON.stringify(tc.input).slice(0, 80);
    console.log(`[${elapsed}s] [tool ] ${id}: ${tc.name}(${inputStr}) ${tc.isError ? "❌" : "✓"}`);
  });
  orch.on("message", (m) => {
    if (m.speaker === "user") return;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const len = m.content.length;
    const preview = m.content.slice(0, 100).replace(/\n/g, " ");
    console.log(`[${elapsed}s] [msg  ] ${m.speaker} (${len} chars, $${m.costUsd?.toFixed(4) ?? "?"}, mentions=${m.mentions?.join(",") || "none"}): ${preview}${len > 100 ? "…" : ""}`);
  });
  orch.on("notice", (level, text) => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[${elapsed}s] [${level}] ${text}`);
  });
  orch.on("pause", (reason) => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[${elapsed}s] [PAUSE] ${reason}`);
  });

  // 触发用户输入
  console.log(`\n> ${userInput}\n`);
  orch.userSay(userInput);

  // 等待队列排空（最多 5 分钟）
  const TIMEOUT_MS = 300_000;
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 500));
    const running = (orch as unknown as { running: boolean }).running;
    const queueLen = (orch as unknown as { queue: string[] }).queue.length;
    if (!running && queueLen === 0) break;
  }

  console.log(`\n\n=== Summary ===`);
  console.log(`总 turns: ${orch.scene.totalTurns}`);
  console.log(`总 cost: $${orch.scene.totalCostUsd.toFixed(4)}`);
  console.log(`消息数: ${orch.scene.messages.length}`);
  console.log(`speaker chain: ${orch.scene.messages.map((m) => m.speaker).join(" → ")}`);
  console.log(`总耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`\n各 agent 累计:`);
  const perAgent = new Map<string, { count: number; cost: number; tokIn: number; tokOut: number; tools: number }>();
  for (const m of orch.scene.messages) {
    if (m.speaker === "user") continue;
    const cur = perAgent.get(m.speaker) ?? { count: 0, cost: 0, tokIn: 0, tokOut: 0, tools: 0 };
    cur.count++;
    cur.cost += m.costUsd ?? 0;
    cur.tokIn += m.inputTokens ?? 0;
    cur.tokOut += m.outputTokens ?? 0;
    cur.tools += m.toolCalls?.length ?? 0;
    perAgent.set(m.speaker, cur);
  }
  for (const [id, s] of perAgent) {
    console.log(`  ${id}: ${s.count} 轮  $${s.cost.toFixed(4)}  tok ${s.tokIn}/${s.tokOut}  tools ${s.tools}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e] fatal:", err);
  process.exit(1);
});

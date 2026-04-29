// 非-TUI 入口：readline 版本，用于在 Ink TUI 之前 / 故障回退时跑多 agent 编排
//
// 用法：
//   npx tsx src/stage/repl.ts                    # 默认空 scene
//   /summon ceo engineer tester
//   @ceo 做个登录页
//   /cost
//   /q
//
// Ink TUI 走 src/stage/index.tsx（Phase 2）

import readline from "node:readline";
import { initDb } from "../store/db.js";
import { loadPersonas } from "./personas.js";
import { Orchestrator } from "./orchestrator.js";
import { applyCommand, parseCommand, helpText } from "./commands.js";

async function main() {
  initDb();
  const { byId, errors } = loadPersonas();
  if (errors.length) {
    console.error("[stage] persona errors:", errors);
    process.exit(1);
  }
  console.log(`\n=== MiniClaw Stage (REPL) ===`);
  console.log(`已注册 ${byId.size} personas: ${[...byId.keys()].join(", ")}`);
  console.log(helpText());
  console.log("");

  const orch = new Orchestrator({ registry: byId });

  // 流式输出：text delta 直接打到 stdout
  let currentSpeaker = "";
  orch.on("status", (id, status) => {
    if (status === "thinking" && currentSpeaker !== id) {
      currentSpeaker = id;
      const p = orch.scene.registry.get(id)!;
      process.stdout.write(`\n[${p.name}] `);
    }
    if (status === "idle") currentSpeaker = "";
  });
  orch.on("text", (_id, delta) => process.stdout.write(delta));
  orch.on("toolCall", (id, tc) => {
    process.stdout.write(`\n  🔧 [${id}] ${tc.name} → ${(tc.result ?? "").slice(0, 60).replace(/\n/g, " ")}`);
  });
  orch.on("message", (m) => {
    if (m.speaker === "user") return; // user 输入已在 prompt 显示
    process.stdout.write("\n");
  });
  orch.on("notice", (level, text) => {
    const tag = level === "error" ? "❌" : level === "warn" ? "⚠️ " : "ℹ️ ";
    console.log(`\n${tag} ${text}`);
  });
  orch.on("totals", (cost, turns) => {
    process.stdout.write(`  [scene: $${cost.toFixed(4)} / ${turns} turns]\n`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question("> ", handle);

  function handle(line: string) {
    const action = parseCommand(line);
    const result = applyCommand(action, orch);
    if (result.kind === "quit") {
      console.log("bye 👋");
      process.exit(0);
    } else if (result.kind === "error") {
      console.log(`❌ ${result.text}`);
    } else if (result.kind === "ok" && result.text) {
      console.log(result.text);
    } else if (result.kind === "save" || result.kind === "load") {
      console.log(`[${result.kind}] not implemented in Phase 3 (Phase 4 task)`);
    }
    setImmediate(prompt);
  }

  prompt();
}

main().catch((err) => {
  console.error("[stage] fatal:", err);
  process.exit(1);
});

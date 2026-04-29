// Ink 入口: pnpm stage 启动
//
// 加载 personas → 启 orchestrator → render Ink App
// 退出：/q 或 Ctrl-C

import React from "react";
import { render } from "ink";
import { initDb } from "../store/db.js";
import { loadPersonas } from "./personas.js";
import { Orchestrator } from "./orchestrator.js";
import { createStore } from "./ui/store.js";
import { App } from "./ui/App.js";

async function main() {
  initDb();
  const { byId, errors } = loadPersonas();
  if (errors.length) {
    console.error("[stage] persona errors:", errors);
    process.exit(1);
  }
  if (!byId.size) {
    console.error("[stage] 没有 persona 可用，请检查 personas/ 目录");
    process.exit(1);
  }

  const orch = new Orchestrator({ registry: byId });
  const store = createStore(orch);

  const { waitUntilExit } = render(<App orch={orch} store={store} />);
  await waitUntilExit();
  process.exit(0);
}

main().catch((err) => {
  console.error("[stage] fatal:", err);
  process.exit(1);
});

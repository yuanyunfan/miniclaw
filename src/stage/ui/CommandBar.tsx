import React, { useState } from "react";
import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import type { Orchestrator } from "../orchestrator.js";
import { applyCommand, parseCommand, helpText } from "../commands.js";
import { saveScene, loadScene } from "../scene-store.js";
import type { Store } from "./store.js";

export const CommandBar: React.FC<{ orch: Orchestrator; store: Store }> = ({ orch, store }) => {
  const [value, setValue] = useState("");
  const { exit } = useApp();

  const handle = (raw: string) => {
    setValue("");
    if (!raw.trim()) return;
    const action = parseCommand(raw);
    const result = applyCommand(action, orch);
    switch (result.kind) {
      case "quit":
        exit();
        return;
      case "error":
        store.pushNotice("error", result.text);
        return;
      case "save":
        try {
          const r = saveScene(orch, result.name);
          store.pushNotice("info", `💾 saved as '${r.name}' → ${r.path.replace(process.env.HOME ?? "", "~")}`);
        } catch (err) {
          store.pushNotice("error", `save failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      case "load": {
        const r = loadScene(orch, result.name);
        if (r.ok) {
          store.refreshFromOrch();
          store.pushNotice("info", `📂 loaded '${result.name}' (${r.messageCount} msgs)`);
        } else {
          store.pushNotice("error", `load failed: ${r.reason}`);
        }
        return;
      }
      case "ok":
        if (result.text) {
          // 多行帮助类输出 → 拆行 push notice
          for (const line of result.text.split("\n").slice(0, 12)) {
            if (line.trim()) store.pushNotice("info", line);
          }
        }
        // mode 切换需要同步 UI state
        if (action.kind === "mode") store.setMode(action.mode);
        return;
    }
  };

  return (
    <Box borderStyle="round" borderColor="white" paddingX={1}>
      <Text color="white" bold>{">"} </Text>
      <TextInput value={value} onChange={setValue} onSubmit={handle} placeholder="输入消息或 /help 看命令" />
    </Box>
  );
};

export { helpText };

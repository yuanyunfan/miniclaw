import React from "react";
import { Box, Text } from "ink";
import type { Orchestrator } from "../orchestrator.js";
import { Roster } from "./Roster.js";
import { Stream } from "./Stream.js";
import { Detail } from "./Detail.js";
import { CommandBar } from "./CommandBar.js";
import { useStore, type Store } from "./store.js";

export const App: React.FC<{ orch: Orchestrator; store: Store }> = ({ orch, store }) => {
  const state = useStore(store);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="magentaBright" bold>🎭 MiniClaw Stage</Text>
        <Text dimColor> · scene {orch.scene.id.slice(0, 8)} · {state.mode}</Text>
      </Box>
      <Box>
        <Roster state={state} orch={orch} />
        <Stream state={state} orch={orch} />
        <Detail state={state} orch={orch} />
      </Box>
      {/* notice strip：独立一行，不再嵌在 stream 里 */}
      {state.notices.length > 0 ? (
        <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
          {state.notices.slice(-3).map((n, i) => (
            <Text key={`n-${n.ts}-${i}`} color={n.level === "error" ? "red" : n.level === "warn" ? "yellow" : "blue"}>
              {n.level === "error" ? "❌" : n.level === "warn" ? "⚠️" : "ℹ️"} {n.text}
            </Text>
          ))}
        </Box>
      ) : null}
      <CommandBar orch={orch} store={store} />
    </Box>
  );
};

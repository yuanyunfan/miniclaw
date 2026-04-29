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
      <CommandBar orch={orch} store={store} />
    </Box>
  );
};

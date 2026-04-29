import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Orchestrator } from "../orchestrator.js";
import type { UIState } from "./store.js";

const STATUS_ICON: Record<string, string> = {
  idle: "⏸",
  thinking: "🧠",
  speaking: "💬",
  "tool-call": "🔧",
  aborted: "✗",
  done: "✓",
};
const STATUS_COLOR: Record<string, string> = {
  idle: "gray",
  thinking: "cyan",
  speaking: "green",
  "tool-call": "yellow",
  aborted: "red",
  done: "blue",
};

export const Roster: React.FC<{ state: UIState; orch: Orchestrator }> = ({ state, orch }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={28}>
      <Text bold color="magenta">🎭 Roster</Text>
      {state.participants.length === 0 ? (
        <Text dimColor>(无 agent，/summon 召唤)</Text>
      ) : (
        state.participants.map((id) => {
          const p = orch.scene.registry.get(id);
          const status = state.agentStatus.get(id) ?? "idle";
          const color = STATUS_COLOR[status] ?? "white";
          const icon = STATUS_ICON[status] ?? "?";
          return (
            <Box key={id}>
              {(status === "thinking" || status === "tool-call") ? (
                <Text color={color}>
                  <Spinner type="dots" /> {p?.emoji ?? "🤖"} {p?.name ?? id}
                </Text>
              ) : (
                <Text color={color}>
                  {icon} {p?.emoji ?? "🤖"} {p?.name ?? id}
                </Text>
              )}
            </Box>
          );
        })
      )}
      <Text> </Text>
      <Text dimColor>未召唤：</Text>
      {[...orch.scene.registry.keys()]
        .filter((id) => !state.participants.includes(id))
        .map((id) => {
          const p = orch.scene.registry.get(id)!;
          return (
            <Text key={id} dimColor>
              ○ {p.emoji} {p.name}
            </Text>
          );
        })}
    </Box>
  );
};

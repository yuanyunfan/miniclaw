import React from "react";
import { Box, Text } from "ink";
import type { Orchestrator } from "../orchestrator.js";
import type { UIState } from "./store.js";

export const Detail: React.FC<{ state: UIState; orch: Orchestrator }> = ({ state, orch }) => {
  const id = state.activeSpeaker;
  const persona = id ? orch.scene.registry.get(id) : null;

  // 累计 per-agent 统计
  let agentTokensIn = 0;
  let agentTokensOut = 0;
  let agentCost = 0;
  let agentTools = 0;
  if (id) {
    for (const m of state.messages) {
      if (m.speaker !== id) continue;
      agentTokensIn += m.inputTokens ?? 0;
      agentTokensOut += m.outputTokens ?? 0;
      agentCost += m.costUsd ?? 0;
      agentTools += m.toolCalls?.length ?? 0;
    }
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={30}>
      <Text bold color="yellow">📊 Active</Text>
      {!persona ? (
        <Text dimColor>(无 active agent)</Text>
      ) : (
        <>
          <Text>{persona.emoji} <Text bold>{persona.name}</Text></Text>
          <Text dimColor>id: {persona.id}</Text>
          <Text dimColor>status: {state.agentStatus.get(persona.id) ?? "?"}</Text>
          <Text> </Text>
          <Text dimColor>累计：</Text>
          <Text>tok in: {agentTokensIn}</Text>
          <Text>tok out: {agentTokensOut}</Text>
          <Text>tools: {agentTools}</Text>
          <Text>cost: ${agentCost.toFixed(4)}</Text>
        </>
      )}

      <Text> </Text>
      <Text bold color="white">Scene</Text>
      <Text>turns: {state.totalTurns}/{state.turnCap}</Text>
      <Text color={state.totalCostUsd > state.budgetCapUsd * 0.7 ? "red" : "white"}>
        cost: ${state.totalCostUsd.toFixed(4)}/${state.budgetCapUsd}
      </Text>
      <Text>mode: {state.mode}</Text>
      {state.pauseReason ? (
        <>
          <Text> </Text>
          <Text color="red" bold>⏸ PAUSED</Text>
          <Text color="yellow">{truncate(state.pauseReason, 60)}</Text>
        </>
      ) : null}
    </Box>
  );
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

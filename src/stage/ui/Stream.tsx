import React from "react";
import { Box, Text } from "ink";
import type { Orchestrator } from "../orchestrator.js";
import type { UIState } from "./store.js";

const TAIL = 20;

export const Stream: React.FC<{ state: UIState; orch: Orchestrator }> = ({ state, orch }) => {
  const recent = state.messages.slice(-TAIL);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1}>
      <Text bold color="cyan">💬 Stream</Text>
      {recent.length === 0 ? (
        <Text dimColor>(空 scene — 输入文字开始)</Text>
      ) : (
        recent.map((m, i) => {
          const ts = new Date(m.ts).toLocaleTimeString("en-GB").slice(0, 8);
          if (m.speaker === "user") {
            return (
              <Box key={i}>
                <Text dimColor>[{ts}] </Text>
                <Text color="white" bold>yyf: </Text>
                <Text>{m.content}</Text>
              </Box>
            );
          }
          const p = orch.scene.registry.get(m.speaker);
          const tag = p ? `${p.emoji} ${p.name}` : m.speaker;
          return (
            <Box key={i} flexDirection="column">
              <Box>
                <Text dimColor>[{ts}] </Text>
                <Text color="green" bold>{tag}: </Text>
                <Text>{truncate(m.content, 280)}</Text>
              </Box>
              {m.toolCalls?.length ? (
                <Box marginLeft={2} flexDirection="column">
                  {m.toolCalls.slice(0, 3).map((tc, j) => (
                    <Text key={j} dimColor>
                      🔧 {tc.name} {tc.isError ? "❌" : "✓"}
                    </Text>
                  ))}
                </Box>
              ) : null}
            </Box>
          );
        })
      )}
      {/* 当前 streaming buffer */}
      {[...state.streamingBuffers.entries()].map(([id, buf]) => {
        const p = orch.scene.registry.get(id);
        const tag = p ? `${p.emoji} ${p.name}` : id;
        return (
          <Box key={`s-${id}`}>
            <Text color="yellow" bold>{tag} (…): </Text>
            <Text>{truncate(buf, 200)}</Text>
          </Box>
        );
      })}
      {/* notice 区 */}
      {state.notices.slice(-3).map((n, i) => (
        <Text key={`n-${i}`} color={n.level === "error" ? "red" : n.level === "warn" ? "yellow" : "blue"} dimColor>
          · {n.text}
        </Text>
      ))}
    </Box>
  );
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

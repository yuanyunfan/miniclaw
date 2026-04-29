import React from "react";
import { Box, Text } from "ink";
import type { Orchestrator } from "../orchestrator.js";
import type { UIState } from "./store.js";

// 只显示最近 6 条完整消息（避免滚出屏幕），文字不截断让 Ink 自然换行
const TAIL = 6;

export const Stream: React.FC<{ state: UIState; orch: Orchestrator }> = ({ state, orch }) => {
  const recent = state.messages.slice(-TAIL);
  const omitted = state.messages.length - recent.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1}>
      <Text bold color="cyan">💬 Stream {omitted > 0 ? <Text dimColor>(前 {omitted} 条已省略，/save 保存全文回看)</Text> : null}</Text>
      {recent.length === 0 ? (
        <Text dimColor>(空 scene — 输入文字开始)</Text>
      ) : (
        recent.map((m, i) => {
          const ts = new Date(m.ts).toLocaleTimeString("en-GB").slice(0, 8);
          if (m.speaker === "user") {
            return (
              <Box key={i} marginTop={1}>
                <Text dimColor>[{ts}] </Text>
                <Text color="white" bold>yyf: </Text>
                <Text>{m.content}</Text>
              </Box>
            );
          }
          const p = orch.scene.registry.get(m.speaker);
          const tag = p ? `${p.emoji} ${p.name}` : m.speaker;
          return (
            <Box key={i} flexDirection="column" marginTop={1}>
              <Box>
                <Text dimColor>[{ts}] </Text>
                <Text color="green" bold>{tag}: </Text>
              </Box>
              <Box marginLeft={2}>
                <Text wrap="wrap">{m.content}</Text>
              </Box>
              {m.toolCalls?.length ? (
                <Box marginLeft={2} flexDirection="column">
                  {m.toolCalls.slice(0, 5).map((tc, j) => (
                    <Text key={j} dimColor>
                      🔧 {tc.name} {tc.isError ? "❌" : "✓"} <Text>{shortInput(tc.input)}</Text>
                    </Text>
                  ))}
                </Box>
              ) : null}
              {typeof m.costUsd === "number" ? (
                <Box marginLeft={2}>
                  <Text dimColor>
                    ${m.costUsd.toFixed(4)} · {m.iters ?? "-"} iters · in:{m.inputTokens ?? "-"} out:{m.outputTokens ?? "-"}
                  </Text>
                </Box>
              ) : null}
            </Box>
          );
        })
      )}
      {/* 当前 streaming buffer：tail 200 字 */}
      {[...state.streamingBuffers.entries()].map(([id, buf]) => {
        const p = orch.scene.registry.get(id);
        const tag = p ? `${p.emoji} ${p.name}` : id;
        const tail = buf.length > 200 ? "…" + buf.slice(-200) : buf;
        return (
          <Box key={`s-${id}`} flexDirection="column" marginTop={1}>
            <Text color="yellow" bold>{tag} (…)</Text>
            <Box marginLeft={2}>
              <Text wrap="wrap">{tail}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

function shortInput(input: unknown, max = 40): string {
  let s: string;
  try { s = JSON.stringify(input); } catch { s = String(input); }
  return s.length > max ? s.slice(0, max) + "…" : s;
}

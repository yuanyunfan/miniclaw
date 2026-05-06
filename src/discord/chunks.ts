const DISCORD_LIMIT = 2000;
const FENCE_CLOSE = "\n```";

function normalizeFence(line: string): string {
  const fence = line.trim();
  return fence.length <= 80 ? fence : "```";
}

function nextOpenFence(current: string, text: string): string {
  let openFence = current;
  const matches = text.matchAll(/^```.*$/gm);
  for (const match of matches) {
    openFence = openFence ? "" : normalizeFence(match[0]);
  }
  return openFence;
}

export function chunkMessage(text: string, fallback = "[无文字回复]"): string[] {
  if (!text.trim()) return [(fallback.trim() || "[无文字回复]").slice(0, DISCORD_LIMIT)];
  if (text.length <= DISCORD_LIMIT) return [text];

  const chunks: string[] = [];
  let offset = 0;
  let openFence = "";

  while (offset < text.length) {
    const prefix = openFence ? `${openFence}\n` : "";
    const bodyLimit = Math.max(1, DISCORD_LIMIT - prefix.length - FENCE_CLOSE.length);
    let body = text.slice(offset, offset + bodyLimit);
    const isFinal = offset + body.length >= text.length;

    if (!isFinal) {
      const lastNewline = body.lastIndexOf("\n");
      if (lastNewline > bodyLimit * 0.3) {
        body = body.slice(0, lastNewline);
      }
    }

    const nextFence = nextOpenFence(openFence, body);
    const slice = prefix + body + (nextFence ? FENCE_CLOSE : "");

    chunks.push(slice);
    offset += body.length;
    openFence = nextFence;
  }

  return chunks;
}

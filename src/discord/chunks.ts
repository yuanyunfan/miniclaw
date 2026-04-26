const DISCORD_LIMIT = 2000;

export function chunkMessage(text: string): string[] {
  if (text.length <= DISCORD_LIMIT) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let openFence = "";

  while (remaining.length > 0) {
    let slice = remaining.slice(0, DISCORD_LIMIT);

    if (openFence && !slice.startsWith(openFence)) {
      slice = openFence + "\n" + slice;
      slice = slice.slice(0, DISCORD_LIMIT);
    }

    const lastNewline = slice.lastIndexOf("\n");
    if (remaining.length > DISCORD_LIMIT && lastNewline > DISCORD_LIMIT * 0.3) {
      slice = slice.slice(0, lastNewline);
    }

    const fenceMatches = slice.match(/^```/gm);
    const fenceCount = fenceMatches ? fenceMatches.length : 0;

    if (fenceCount % 2 !== 0) {
      const lastFenceIdx = slice.lastIndexOf("```");
      const afterFence = slice.slice(lastFenceIdx + 3).split("\n")[0] ?? "";
      slice += "\n```";
      openFence = "```" + afterFence.trim();
    } else {
      openFence = "";
    }

    chunks.push(slice);
    remaining = remaining.slice(slice.replace(/\n```$/, "").length);
  }

  return chunks;
}

const DISCORD_LIMIT = 2000;
const FENCE_CLOSE = "\n```";
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

export interface ChunkedDiscordText {
  content: string;
  suppressEmbeds: boolean;
  kind: "body" | "link_preview_footer";
}

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

function countChar(text: string, ch: string): number {
  let count = 0;
  for (const c of text) if (c === ch) count++;
  return count;
}

function trimUrlCandidate(raw: string): string {
  let url = raw.replace(/[.,!?;:，。！？；：、]+$/g, "");
  while (url.endsWith(")") && countChar(url, ")") > countChar(url, "(")) url = url.slice(0, -1);
  while (url.endsWith("]") && countChar(url, "]") > countChar(url, "[")) url = url.slice(0, -1);
  return url;
}

export function extractPreviewLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? -1;
    const end = start + match[0].length;
    if (start > 0 && text[start - 1] === "<" && text[end] === ">") continue;
    const url = trimUrlCandidate(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

export function buildLinkPreviewFooter(links: string[]): string {
  return [
    "🔗 链接预览集中区",
    ...links.map((url, idx) => `${idx + 1}. ${url}`),
  ].join("\n");
}

export function chunkMessageWithDeferredLinkPreviews(
  text: string,
  fallback = "[无文字回复]",
): ChunkedDiscordText[] {
  const links = extractPreviewLinks(text);
  const chunks: ChunkedDiscordText[] = chunkMessage(text, fallback).map((content) => ({
    content,
    suppressEmbeds: links.length > 0,
    kind: "body",
  }));
  if (!links.length) return chunks;

  chunks.push(...chunkMessage(buildLinkPreviewFooter(links)).map((content) => ({
    content,
    suppressEmbeds: false,
    kind: "link_preview_footer" as const,
  })));
  return chunks;
}

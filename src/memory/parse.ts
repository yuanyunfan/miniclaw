const PATTERNS = [
  /^记住[：:]\s*(.+)/s,
  /^记住\s+(.+)/s,
  /^remember[：:]\s*(.+)/is,
  /^remember\s+(.+)/is,
  /^\/memory[：:]\s*(.+)/is,
  /^\/memory\s+(.+)/is,
];

export interface ExplicitMemory {
  type: string;
  name: string;
  content: string;
}

export function parseExplicitMemory(text: string): ExplicitMemory | null {
  const trimmed = text.trim();
  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const content = match[1].trim();
      if (!content) return null;
      const name = content.slice(0, 30).replace(/\n/g, " ");
      return { type: "user", name, content };
    }
  }
  return null;
}

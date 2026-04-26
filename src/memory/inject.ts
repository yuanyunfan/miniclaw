import { getAllMemories, type MemoryRow } from "../store/memory.js";

const TYPE_LABELS: Record<string, string> = {
  user: "用户信息",
  feedback: "反馈偏好",
  project: "项目信息",
  reference: "参考资料",
};

export function buildMemoryPrompt(maxChars = 4000): string {
  const memories = getAllMemories();
  if (!memories.length) return "";

  const grouped = new Map<string, MemoryRow[]>();
  for (const m of memories) {
    const list = grouped.get(m.type) ?? [];
    list.push(m);
    grouped.set(m.type, list);
  }

  const sections: string[] = [];
  let totalLen = 0;

  for (const [type, rows] of grouped) {
    const label = TYPE_LABELS[type] ?? type;
    const lines: string[] = [`[${label}]`];
    for (const r of rows) {
      const line = `- ${r.name}: ${r.content}`;
      if (totalLen + line.length > maxChars) break;
      lines.push(line);
      totalLen += line.length;
    }
    if (lines.length > 1) sections.push(lines.join("\n"));
    if (totalLen >= maxChars) break;
  }

  if (!sections.length) return "";
  return `<memories>\n${sections.join("\n\n")}\n</memories>`;
}

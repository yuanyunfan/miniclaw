export function pushCompactedLine(lines: string[], line: string): boolean {
  const lastIdx = lines.length - 1;
  if (lastIdx >= 0) {
    const last = lines[lastIdx];
    const baseLast = last.replace(/\s+\(×\d+\)$/, "");
    if (baseLast === line) {
      const m = last.match(/\(×(\d+)\)$/);
      const next = m ? parseInt(m[1], 10) + 1 : 2;
      lines[lastIdx] = `${line} (×${next})`;
      return false;
    }
  }
  lines.push(line);
  return true;
}

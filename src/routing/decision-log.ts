import { createHash } from "node:crypto";

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

export function promptPreview(prompt: string, maxChars: number): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, Math.max(0, maxChars - 1)) + "…";
}

import { createHash } from "node:crypto";
import type { EmailAddress, EmailAttachmentMeta, EmailMessage } from "./types.js";

export function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function resolveHome(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return `${process.env.HOME ?? ""}/${path.slice(2)}`;
  return path;
}

export function domainOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return undefined;
  return address.slice(at + 1).toLowerCase();
}

export function redactEmailAddress(address: EmailAddress): EmailAddress {
  const domain = domainOf(address.address);
  return {
    name: address.name,
    address: domain ? `[redacted]@${domain}` : undefined,
  };
}

export function sanitizeEmailError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(password|token|cookie|secret|access_token|pass)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/([A-Za-z0-9+/=_-]{24,})/g, "[redacted]")
    .slice(0, 800);
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function matchesAddressPattern(address: string | undefined, patterns: string[]): boolean {
  if (!patterns.length) return true;
  const normalized = address?.trim().toLowerCase();
  const domain = domainOf(normalized);
  if (!normalized && !domain) return false;
  return patterns.some((pattern) => {
    const p = pattern.trim().toLowerCase();
    if (!p) return false;
    if (p.includes("@") || p.includes("*")) {
      return Boolean(normalized && wildcardToRegExp(p).test(normalized));
    }
    return domain === p || domain?.endsWith(`.${p}`);
  });
}

export function subjectMatches(subject: string, includes: string[]): boolean {
  if (!includes.length) return true;
  const normalized = subject.toLowerCase();
  return includes.some((part) => part.trim() && normalized.includes(part.trim().toLowerCase()));
}

function stripAttachmentContent(attachment: EmailAttachmentMeta): Omit<EmailAttachmentMeta, "text"> {
  const { text: _text, ...withoutText } = attachment;
  return withoutText;
}

export function stripBodyForOutput(message: EmailMessage): Omit<EmailMessage, "text" | "html"> & { text_excerpt?: string } {
  const text = message.text?.replace(/\s+/g, " ").trim();
  const { text: _text, html: _html, ...withoutBody } = message;
  return {
    ...withoutBody,
    from: redactEmailAddress(message.from),
    to: message.to.map(redactEmailAddress),
    attachments: message.attachments.map(stripAttachmentContent),
    ...(text ? { text_excerpt: text.slice(0, 500) } : {}),
  };
}

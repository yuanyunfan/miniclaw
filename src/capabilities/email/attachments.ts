import { extname } from "node:path";
import { unzipSync } from "fflate";
import type { EmailAttachmentMeta } from "./types.js";

interface RawAttachment {
  filename?: string;
  contentType?: string;
  size?: number;
  checksum?: string;
  content?: Buffer | Uint8Array;
}

export interface AttachmentExtractionOptions {
  includeContent: boolean;
  allowedExtensions: string[];
  maxTextBytes: number;
}

const DEFAULT_ALLOWED_EXTENSIONS = [".txt", ".csv", ".html", ".htm", ".json", ".xml", ".zip"];
const DEFAULT_MAX_TEXT_BYTES = 128_000;

function normalizeExt(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function normalizeAllowedAttachmentExtensions(input: string[] | undefined): string[] {
  const values = input?.length ? input : DEFAULT_ALLOWED_EXTENSIONS;
  return [...new Set(values.map(normalizeExt).filter(Boolean))];
}

function attachmentExt(attachment: RawAttachment): string {
  return normalizeExt(extname(attachment.filename ?? ""));
}

function isTextLike(ext: string, contentType: string | undefined): boolean {
  const normalizedType = contentType?.toLowerCase() ?? "";
  return [".txt", ".csv", ".html", ".htm", ".json", ".xml"].includes(ext)
    || normalizedType.startsWith("text/")
    || ["application/json", "application/xml", "application/csv"].includes(normalizedType);
}

function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean; bytes: number } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return { text, truncated: false, bytes: buf.byteLength };
  return {
    text: buf.subarray(0, maxBytes).toString("utf8"),
    truncated: true,
    bytes: maxBytes,
  };
}

function decodeText(buffer: Buffer | Uint8Array, maxBytes: number): { text: string; truncated: boolean; bytes: number } {
  return truncateText(Buffer.from(buffer).toString("utf8").replace(/\u0000/g, ""), maxBytes);
}

function safeReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/[A-Za-z0-9+/=_-]{24,}/g, "[redacted]").slice(0, 240);
}

function extractZipText(
  attachment: RawAttachment,
  allowedExtensions: string[],
  maxTextBytes: number,
): Pick<EmailAttachmentMeta, "text" | "text_truncated" | "extraction"> {
  if (!attachment.content) {
    return { extraction: { status: "skipped", reason: "attachment content unavailable" } };
  }
  try {
    const entries = unzipSync(new Uint8Array(attachment.content));
    const extracted: string[] = [];
    const entryMeta: NonNullable<NonNullable<EmailAttachmentMeta["extraction"]>["entries"]> = [];
    let remaining = maxTextBytes;
    let truncated = false;
    for (const [name, data] of Object.entries(entries)) {
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const ext = normalizeExt(extname(name));
      if (!allowedExtensions.includes(ext) || !isTextLike(ext, undefined)) continue;
      const decoded = decodeText(data, remaining);
      remaining -= decoded.bytes;
      truncated = truncated || decoded.truncated;
      extracted.push(`\n[attachment:${name}]\n${decoded.text}`);
      entryMeta.push({ filename: name, size: data.byteLength, text_bytes: decoded.bytes, text_truncated: decoded.truncated });
    }
    if (!extracted.length) {
      return { extraction: { status: "skipped", reason: "zip contained no allowed text entries" } };
    }
    return {
      text: extracted.join("\n").trim(),
      text_truncated: truncated,
      extraction: { status: "extracted", entries: entryMeta },
    };
  } catch (err) {
    return { extraction: { status: "failed", reason: `zip extraction failed: ${safeReason(err)}` } };
  }
}

export function normalizeEmailAttachment(
  attachment: RawAttachment,
  options: Partial<AttachmentExtractionOptions> = {},
): EmailAttachmentMeta {
  const includeContent = options.includeContent ?? false;
  const allowedExtensions = normalizeAllowedAttachmentExtensions(options.allowedExtensions);
  const maxTextBytes = Math.max(1, options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES);
  const ext = attachmentExt(attachment);
  const base: EmailAttachmentMeta = {
    filename: attachment.filename,
    content_type: attachment.contentType,
    size: attachment.size,
    checksum: attachment.checksum,
  };

  if (!includeContent) return { ...base, extraction: { status: "metadata_only" } };
  if (!allowedExtensions.includes(ext)) {
    return { ...base, extraction: { status: "skipped", reason: `extension not allowed: ${ext || "unknown"}` } };
  }
  if (!attachment.content) {
    return { ...base, extraction: { status: "skipped", reason: "attachment content unavailable" } };
  }
  if (ext === ".zip") return { ...base, ...extractZipText(attachment, allowedExtensions, maxTextBytes) };
  if (!isTextLike(ext, attachment.contentType)) {
    return { ...base, extraction: { status: "skipped", reason: `unsupported content type: ${attachment.contentType ?? "unknown"}` } };
  }
  const decoded = decodeText(attachment.content, maxTextBytes);
  return {
    ...base,
    text: decoded.text,
    text_truncated: decoded.truncated,
    extraction: {
      status: "extracted",
      entries: [{ filename: attachment.filename ?? "attachment", size: attachment.size, text_bytes: decoded.bytes, text_truncated: decoded.truncated }],
    },
  };
}

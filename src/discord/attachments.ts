import type { Attachment } from "discord.js";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import type { CodexInputEntry } from "../agent/codex.js";

export interface AttachmentResult {
  blocks: ContentBlockParam[];
  codexInputs: CodexInputEntry[];
  textSummary: string;
  notices: string[];
}

export interface AttachmentScope {
  cwd?: string;
  scope: string;
}

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const TEXT_EXT = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".log",
  ".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".sql", ".html", ".css",
  ".xml", ".toml", ".ini", ".env", ".gitignore", ".dockerfile",
]);
const TEXT_MAX_BYTES = 1_000_000;

type Kind = "image" | "pdf" | "text" | "audio" | "binary";

function classify(att: Attachment): Kind {
  const ct = (att.contentType ?? "").toLowerCase();
  const ext = extname(att.name ?? "").toLowerCase();
  if (IMAGE_MIME.test(ct) || IMAGE_EXT.has(ext)) return "image";
  if (ct === "application/pdf" || ext === ".pdf") return "pdf";
  if (ct.startsWith("audio/") || [".mp3", ".m4a", ".wav", ".ogg", ".flac"].includes(ext)) return "audio";
  if (ct.startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  return "binary";
}

function imageMediaType(att: Attachment): "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
  const ct = (att.contentType ?? "").toLowerCase();
  if (ct === "image/png") return "image/png";
  if (ct === "image/gif") return "image/gif";
  if (ct === "image/webp") return "image/webp";
  if (ct === "image/jpeg" || ct === "image/jpg") return "image/jpeg";
  const ext = extname(att.name ?? "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function safeName(name: string): string {
  const b = basename(name).replace(/[^\w.\-一-龥]+/g, "_");
  return b.slice(0, 200) || "file";
}

async function downloadToBuffer(url: string, timeoutMs = config.attachmentTimeoutMs): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`attachment download timeout after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (ctrl.signal.aborted) {
      throw new Error(`attachment download timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function attachmentBaseDir(opts: AttachmentScope): string {
  return opts.cwd
    ? join(opts.cwd, ".miniclaw-attachments", opts.scope)
    : join(tmpdir(), "miniclaw-attachments", opts.scope);
}

function ensureBaseDir(opts: AttachmentScope): string {
  const root = attachmentBaseDir(opts);
  mkdirSync(root, { recursive: true });
  return root;
}

export function cleanupAttachmentScope(opts: AttachmentScope): void {
  rmSync(attachmentBaseDir(opts), { recursive: true, force: true });
}

export async function processAttachments(
  attachments: Attachment[],
  opts: AttachmentScope,
): Promise<AttachmentResult> {
  const blocks: ContentBlockParam[] = [];
  const codexInputs: CodexInputEntry[] = [];
  const notices: string[] = [];
  const summaryParts: string[] = [];
  const maxBytes = config.maxAttachmentMb * 1024 * 1024;

  let kept: Attachment[] = attachments;
  if (kept.length > config.maxAttachments) {
    notices.push(`⚠️ 单条消息附件超过 ${config.maxAttachments} 个，仅处理前 ${config.maxAttachments} 个`);
    kept = kept.slice(0, config.maxAttachments);
  }

  let baseDir: string | null = null;
  const ensureDir = (): string => {
    if (!baseDir) baseDir = ensureBaseDir(opts);
    return baseDir;
  };

  for (const att of kept) {
    const name = att.name ?? "file";
    if (att.size > maxBytes) {
      notices.push(`⚠️ \`${name}\` 超过 ${config.maxAttachmentMb}MB 上限，已忽略`);
      continue;
    }

    const kind = classify(att);
    summaryParts.push(`${name}(${kind})`);

    try {
      switch (kind) {
        case "image": {
          const buf = await downloadToBuffer(att.url);
          const media_type = imageMediaType(att);
          blocks.push({
            type: "image",
            source: { type: "base64", media_type, data: buf.toString("base64") },
          });
          const dir = ensureDir();
          const path = join(dir, safeName(name));
          writeFileSync(path, buf);
          codexInputs.push({ type: "local_image", path });
          break;
        }
        case "pdf": {
          const buf = await downloadToBuffer(att.url);
          blocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
            ...(name ? { title: name } : {}),
          });
          const dir = ensureDir();
          const path = join(dir, safeName(name));
          writeFileSync(path, buf);
          codexInputs.push({
            type: "text",
            text: `📎 PDF 附件 \`${name}\` (${(att.size / 1024).toFixed(1)} KB) 已保存到：${path}\n请用命令行工具读取或分析。`,
          });
          break;
        }
        case "text": {
          if (att.size > TEXT_MAX_BYTES) {
            const dir = ensureDir();
            const buf = await downloadToBuffer(att.url);
            const path = join(dir, safeName(name));
            writeFileSync(path, buf);
            const text = `📎 文件 \`${name}\` (${(att.size / 1024).toFixed(1)} KB) 较大，已保存到：${path}\n请用 Read/命令行工具读取。`;
            blocks.push({ type: "text", text });
            codexInputs.push({ type: "text", text });
          } else {
            const buf = await downloadToBuffer(att.url);
            const text = buf.toString("utf8");
            const inline = `<file name="${name}" size="${att.size}">\n${text}\n</file>`;
            blocks.push({ type: "text", text: inline });
            codexInputs.push({ type: "text", text: inline });
          }
          break;
        }
        case "audio": {
          notices.push(`⚠️ \`${name}\` 是语音文件，暂不支持自动转写（后续可接入 Whisper API）`);
          break;
        }
        case "binary":
        default: {
          const dir = ensureDir();
          const buf = await downloadToBuffer(att.url);
          const path = join(dir, safeName(name));
          writeFileSync(path, buf);
          const text = `📎 二进制附件 \`${name}\` (${(att.size / 1024).toFixed(1)} KB) 已保存到：${path}\n请用 Bash/Read/命令行工具查看。`;
          blocks.push({ type: "text", text });
          codexInputs.push({ type: "text", text });
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notices.push(`❌ \`${name}\` 处理失败: ${msg}`);
    }
  }

  // 图片走 Discord CDN URL：作为额外回退，把图片的 URL 也加到 textSummary 里以便排查
  const textSummary = summaryParts.length ? `[附件: ${summaryParts.join(", ")}]` : "";

  return { blocks, codexInputs, textSummary, notices };
}

export const __testables = { classify, imageMediaType, safeName, downloadToBuffer, attachmentBaseDir };

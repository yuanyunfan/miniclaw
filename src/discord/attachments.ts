import type { Attachment } from "discord.js";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";

export interface AttachmentResult {
  blocks: ContentBlockParam[];
  textSummary: string;
  notices: string[];
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

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function pickBaseDir(opts: { cwd?: string }, scope: string): string {
  const root = opts.cwd
    ? join(opts.cwd, ".miniclaw-attachments", scope)
    : join(tmpdir(), "miniclaw-attachments", scope);
  mkdirSync(root, { recursive: true });
  return root;
}

export async function processAttachments(
  attachments: Attachment[],
  opts: { cwd?: string; scope: string },
): Promise<AttachmentResult> {
  const blocks: ContentBlockParam[] = [];
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
    if (!baseDir) baseDir = pickBaseDir(opts, opts.scope);
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
          break;
        }
        case "pdf": {
          const buf = await downloadToBuffer(att.url);
          blocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
            ...(name ? { title: name } : {}),
          });
          break;
        }
        case "text": {
          if (att.size > TEXT_MAX_BYTES) {
            const dir = ensureDir();
            const buf = await downloadToBuffer(att.url);
            const path = join(dir, safeName(name));
            writeFileSync(path, buf);
            blocks.push({
              type: "text",
              text: `📎 文件 \`${name}\` (${(att.size / 1024).toFixed(1)} KB) 较大，已保存到：${path}\n请用 Read 工具读取。`,
            });
          } else {
            const buf = await downloadToBuffer(att.url);
            const text = buf.toString("utf8");
            blocks.push({
              type: "text",
              text: `<file name="${name}" size="${att.size}">\n${text}\n</file>`,
            });
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
          blocks.push({
            type: "text",
            text: `📎 二进制附件 \`${name}\` (${(att.size / 1024).toFixed(1)} KB) 已保存到：${path}\n请用 Bash/Read 工具查看。`,
          });
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

  return { blocks, textSummary, notices };
}

export const __testables = { classify, imageMediaType, safeName };

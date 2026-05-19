import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProcessableAttachment } from "../../../discord/attachments.js";
import {
  DEFAULT_WEIXIN_BASE_URL,
  DEFAULT_WEIXIN_CDN_BASE_URL,
  getWeixinUploadUrl,
  sendWeixinMessageBody,
  WeixinMessageItemType,
  WeixinMessageState,
  WeixinMessageType,
  WeixinUploadMediaType,
  type WeixinApiOptions,
  type WeixinCdnMedia,
  type WeixinMediaItem,
  type WeixinMessageItem,
} from "./api.js";

const CDN_UPLOAD_MAX_RETRIES = 3;
const SILK_SAMPLE_RATE = 24_000;
const OGG_CAPTURE = Buffer.from("OggS");
const OPUS_HEAD_MAGIC = Buffer.from("OpusHead");
const GP_UNKNOWN = 0xffffffffffffffffn;

export interface WeixinCdnDownloadRef {
  kind: "image" | "voice" | "file" | "video";
  media: WeixinCdnMedia;
  aesKeyBase64?: string;
  outputName: string;
  contentType: string;
}

export interface WeixinProcessableAttachment extends ProcessableAttachment {
  weixinCdn?: WeixinCdnDownloadRef;
}

export interface MaterializedWeixinAttachments {
  attachments: ProcessableAttachment[];
  notices: string[];
}

interface UploadedWeixinFile {
  filekey: string;
  downloadEncryptedQueryParam: string;
  aeskeyHex: string;
  fileSize: number;
  fileSizeCiphertext: number;
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl = DEFAULT_WEIXIN_CDN_BASE_URL): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

function buildCdnUploadUrl(params: { uploadParam: string; filekey: string; cdnBaseUrl: string }): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes`);
}

function aesKeyBase64FromItem(item: WeixinMediaItem | undefined): string | undefined {
  if (item?.aeskey) return Buffer.from(item.aeskey, "hex").toString("base64");
  return item?.media?.aes_key;
}

async function fetchBytes(url: string, label: string, fetchFn?: typeof fetch): Promise<Buffer> {
  const res = await (fetchFn ?? fetch)(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`${label}: CDN download ${res.status} ${res.statusText} body=${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function downloadCdnBuffer(ref: WeixinCdnDownloadRef, label: string, fetchFn?: typeof fetch): Promise<Buffer> {
  const url = ref.media.full_url || buildCdnDownloadUrl(ref.media.encrypt_query_param ?? "");
  const buf = await fetchBytes(url, label, fetchFn);
  if (!ref.aesKeyBase64) return buf;
  return decryptAesEcb(buf, parseAesKey(ref.aesKeyBase64, label));
}

function safeFileName(name: string): string {
  return basename(name).replace(/[^\w.\-一-龥]+/g, "_").slice(0, 200) || "weixin-media";
}

function mimeFromFilename(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4" || ext === ".mov") return "video/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg" || ext === ".opus") return "audio/ogg";
  if (ext === ".silk" || ext === ".slk") return "audio/silk";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  return "application/octet-stream";
}

function extensionFromMime(mime: string, fallback: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "audio/wav") return ".wav";
  if (mime === "audio/silk") return ".silk";
  if (mime === "video/mp4") return ".mp4";
  return extname(fallback) || ".bin";
}

function pcmBytesToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcm.byteLength;
  const totalSize = 44 + pcmBytes;
  const buf = Buffer.allocUnsafe(totalSize);
  let offset = 0;

  buf.write("RIFF", offset); offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset); offset += 4;
  buf.write("WAVE", offset); offset += 4;
  buf.write("fmt ", offset); offset += 4;
  buf.writeUInt32LE(16, offset); offset += 4;
  buf.writeUInt16LE(1, offset); offset += 2;
  buf.writeUInt16LE(1, offset); offset += 2;
  buf.writeUInt32LE(sampleRate, offset); offset += 4;
  buf.writeUInt32LE(sampleRate * 2, offset); offset += 4;
  buf.writeUInt16LE(2, offset); offset += 2;
  buf.writeUInt16LE(16, offset); offset += 2;
  buf.write("data", offset); offset += 4;
  buf.writeUInt32LE(pcmBytes, offset); offset += 4;
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);
  return buf;
}

async function silkToWav(silkBuf: Buffer): Promise<Buffer | null> {
  try {
    const { decode } = await import("silk-wasm");
    const result = await decode(silkBuf, SILK_SAMPLE_RATE);
    return pcmBytesToWav(result.data, SILK_SAMPLE_RATE);
  } catch {
    return null;
  }
}

async function materializeOneAttachment(
  attachment: WeixinProcessableAttachment,
  dir: string,
  fetchFn?: typeof fetch,
): Promise<{ attachment?: ProcessableAttachment; notice?: string }> {
  const ref = attachment.weixinCdn;
  if (!ref) return { attachment };

  try {
    const raw = await downloadCdnBuffer(ref, `${ref.kind}:${ref.outputName}`, fetchFn);
    let out = raw;
    let contentType = ref.contentType;
    let outputName = ref.outputName;
    if (ref.kind === "voice") {
      const wav = await silkToWav(raw);
      if (wav) {
        out = wav;
        contentType = "audio/wav";
        outputName = outputName.replace(/\.[^.]+$/, "") + ".wav";
      } else if (!/\.(silk|slk)$/i.test(outputName)) {
        outputName = outputName.replace(/\.[^.]+$/, "") + ".silk";
        contentType = "audio/silk";
      }
    }

    await mkdir(dir, { recursive: true });
    const filePath = join(dir, safeFileName(outputName || `weixin-${ref.kind}${extensionFromMime(contentType, outputName)}`));
    await writeFile(filePath, out);
    return {
      attachment: {
        name: outputName,
        size: out.length,
        contentType,
        url: pathToFileURL(filePath).toString(),
      },
      notice: ref.kind === "voice" && contentType === "audio/silk"
        ? `收到语音并已解密，但 SILK 转 WAV 不可用，后续转写可能失败：${outputName}`
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { notice: `收到 ${ref.kind}，但下载/解密失败：${msg.slice(0, 300)}` };
  }
}

export async function materializeWeixinAttachments(
  attachments: WeixinProcessableAttachment[],
  options: { dir: string; fetchFn?: typeof fetch },
): Promise<MaterializedWeixinAttachments> {
  const out: ProcessableAttachment[] = [];
  const notices: string[] = [];
  for (const attachment of attachments) {
    const materialized = await materializeOneAttachment(attachment, options.dir, options.fetchFn);
    if (materialized.attachment) out.push(materialized.attachment);
    if (materialized.notice) notices.push(materialized.notice);
  }
  return { attachments: out, notices };
}

export function buildWeixinCdnAttachment(params: {
  kind: WeixinCdnDownloadRef["kind"];
  item: WeixinMediaItem | undefined;
  fallbackName: string;
  fallbackContentType: string;
  size: number;
}): WeixinProcessableAttachment | undefined {
  const { item } = params;
  const directUrl = item?.url ?? item?.download_url ?? item?.file_url ?? item?.image_url ?? item?.media_url ?? item?.cdn_url;
  const name = item?.name ?? item?.file_name ?? item?.filename ?? params.fallbackName;
  const contentType = item?.content_type ?? item?.mime_type ?? params.fallbackContentType;
  if (directUrl) return { url: directUrl, name, contentType, size: params.size };
  if (!item?.media?.encrypt_query_param && !item?.media?.full_url) return undefined;
  return {
    url: `weixin-cdn://${params.kind}/${encodeURIComponent(name)}`,
    name,
    contentType,
    size: params.size,
    weixinCdn: {
      kind: params.kind,
      media: item.media,
      aesKeyBase64: aesKeyBase64FromItem(item),
      outputName: name,
      contentType,
    },
  };
}

async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadFullUrl?: string;
  uploadParam?: string;
  filekey: string;
  cdnBaseUrl: string;
  aeskey: Buffer;
  fetchFn?: typeof fetch;
}): Promise<{ downloadParam: string; ciphertextSize: number }> {
  const ciphertext = encryptAesEcb(params.buf, params.aeskey);
  const url = params.uploadFullUrl?.trim()
    || (params.uploadParam ? buildCdnUploadUrl({ uploadParam: params.uploadParam, filekey: params.filekey, cdnBaseUrl: params.cdnBaseUrl }) : "");
  if (!url) throw new Error("Weixin CDN upload URL missing");

  let lastError: unknown;
  for (let attempt = 1; attempt <= CDN_UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      const res = await (params.fetchFn ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Weixin CDN upload client error ${res.status}: ${await res.text()}`);
      }
      if (res.status !== 200) {
        throw new Error(`Weixin CDN upload server error ${res.status}`);
      }
      const downloadParam = res.headers.get("x-encrypted-param") ?? "";
      if (!downloadParam) throw new Error("Weixin CDN upload response missing x-encrypted-param");
      return { downloadParam, ciphertextSize: ciphertext.length };
    } catch (err) {
      lastError = err;
      if (attempt === CDN_UPLOAD_MAX_RETRIES || (err instanceof Error && err.message.includes("client error"))) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Weixin CDN upload failed");
}

async function uploadFileToWeixin(params: {
  filePath: string;
  toUserId: string;
  mediaType: number;
  options: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedWeixinFile> {
  const plaintext = await readFile(params.filePath);
  const filekey = randomBytes(16).toString("hex");
  const aeskey = randomBytes(16);
  const resp = await getWeixinUploadUrl({
    filekey,
    media_type: params.mediaType,
    to_user_id: params.toUserId,
    rawsize: plaintext.length,
    rawfilemd5: createHash("md5").update(plaintext).digest("hex"),
    filesize: aesEcbPaddedSize(plaintext.length),
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
    options: params.options,
  });
  const code = resp.errcode ?? resp.ret ?? 0;
  if (code !== 0) throw new Error(`Weixin getuploadurl error ${code}: ${resp.errmsg ?? "unknown error"}`);
  const uploaded = await uploadBufferToCdn({
    buf: plaintext,
    uploadFullUrl: resp.upload_full_url,
    uploadParam: resp.upload_param,
    filekey,
    cdnBaseUrl: params.cdnBaseUrl,
    aeskey,
    fetchFn: params.options.fetchFn,
  });
  return {
    filekey,
    downloadEncryptedQueryParam: uploaded.downloadParam,
    aeskeyHex: aeskey.toString("hex"),
    fileSize: plaintext.length,
    fileSizeCiphertext: uploaded.ciphertextSize,
  };
}

function buildMediaItem(params: {
  filePath: string;
  uploaded: UploadedWeixinFile;
  kind: "image" | "video" | "voice" | "file";
  voiceMeta?: { playtimeMs: number; encodeType: number; sampleRate: number };
}): WeixinMessageItem {
  const media = {
    encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
    aes_key: Buffer.from(params.uploaded.aeskeyHex).toString("base64"),
    encrypt_type: 1,
  };
  if (params.kind === "image") {
    return { type: WeixinMessageItemType.IMAGE, image_item: { media, mid_size: params.uploaded.fileSizeCiphertext } };
  }
  if (params.kind === "video") {
    return { type: WeixinMessageItemType.VIDEO, video_item: { media, video_size: params.uploaded.fileSizeCiphertext } };
  }
  if (params.kind === "voice") {
    return {
      type: WeixinMessageItemType.VOICE,
      voice_item: {
        media,
        playtime: params.voiceMeta?.playtimeMs,
        encode_type: params.voiceMeta?.encodeType,
        sample_rate: params.voiceMeta?.sampleRate,
      },
    };
  }
  return {
    type: WeixinMessageItemType.FILE,
    file_item: {
      media,
      file_name: basename(params.filePath),
      len: String(params.uploaded.fileSize),
    },
  };
}

function classifyOutboundFile(filePath: string): "image" | "video" | "voice" | "file" {
  const mime = mimeFromFilename(filePath);
  const ext = extname(filePath).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if ([".ogg", ".opus", ".silk", ".slk"].includes(ext)) return "voice";
  return "file";
}

function skipOggPage(buf: Buffer, start: number): number | null {
  if (start + 27 > buf.length || !buf.subarray(start, start + 4).equals(OGG_CAPTURE)) return null;
  const nsegs = buf[start + 26] ?? 0;
  if (start + 27 + nsegs > buf.length) return null;
  let bodySize = 0;
  for (let i = 0; i < nsegs; i += 1) bodySize += buf[start + 27 + i] ?? 0;
  const end = start + 27 + nsegs + bodySize;
  return end <= buf.length ? end : null;
}

function findOpusStreamSerial(buf: Buffer): number | null {
  let off = 0;
  while (off < buf.length) {
    const idx = buf.indexOf(OGG_CAPTURE, off);
    if (idx < 0) return null;
    const end = skipOggPage(buf, idx);
    if (end === null) {
      off = idx + 1;
      continue;
    }
    const nsegs = buf[idx + 26] ?? 0;
    const bodyStart = idx + 27 + nsegs;
    const firstSegLen = nsegs > 0 ? buf[idx + 27] ?? 0 : 0;
    if (firstSegLen >= OPUS_HEAD_MAGIC.length && bodyStart + firstSegLen <= buf.length) {
      const payload = buf.subarray(bodyStart, bodyStart + firstSegLen);
      if (payload.subarray(0, OPUS_HEAD_MAGIC.length).equals(OPUS_HEAD_MAGIC)) return buf.readUInt32LE(idx + 14);
    }
    off = end;
  }
  return null;
}

function parseOggOpusPlaytimeMs(buf: Buffer): number | null {
  const serial = findOpusStreamSerial(buf);
  if (serial === null) return null;
  let off = 0;
  let maxGp = 0n;
  while (off < buf.length) {
    const idx = buf.indexOf(OGG_CAPTURE, off);
    if (idx < 0) break;
    const end = skipOggPage(buf, idx);
    if (end === null) {
      off = idx + 1;
      continue;
    }
    if (buf.readUInt32LE(idx + 14) === serial) {
      const gp = buf.readBigUInt64LE(idx + 6);
      if (gp !== GP_UNKNOWN && gp > maxGp) maxGp = gp;
    }
    off = end;
  }
  if (maxGp <= 0n) return null;
  return Number((maxGp * 1000n) / 48000n);
}

async function resolveVoiceMeta(filePath: string): Promise<{ playtimeMs: number; encodeType: number; sampleRate: number } | undefined> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".ogg" || ext === ".opus") {
    const head = Buffer.allocUnsafe(65536);
    const handle = await open(filePath, "r");
    try {
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      const playtimeMs = parseOggOpusPlaytimeMs(head.subarray(0, bytesRead));
      return playtimeMs ? { playtimeMs, encodeType: 8, sampleRate: 48_000 } : undefined;
    } finally {
      await handle.close();
    }
  }
  if (ext === ".silk" || ext === ".slk") {
    return { playtimeMs: 1, encodeType: 6, sampleRate: SILK_SAMPLE_RATE };
  }
  return undefined;
}

export async function sendWeixinMediaFile(params: {
  filePath: string;
  to: string;
  text?: string;
  contextToken?: string;
  options: WeixinApiOptions;
  cdnBaseUrl?: string;
}): Promise<{ messageId: string }> {
  const kind = classifyOutboundFile(params.filePath);
  const mediaType = kind === "image"
    ? WeixinUploadMediaType.IMAGE
    : kind === "video"
      ? WeixinUploadMediaType.VIDEO
      : kind === "voice"
        ? WeixinUploadMediaType.VOICE
        : WeixinUploadMediaType.FILE;
  const uploaded = await uploadFileToWeixin({
    filePath: params.filePath,
    toUserId: params.to,
    mediaType,
    options: params.options,
    cdnBaseUrl: params.cdnBaseUrl ?? DEFAULT_WEIXIN_CDN_BASE_URL,
  });
  const voiceMeta = kind === "voice" ? await resolveVoiceMeta(params.filePath) : undefined;
  const itemList: WeixinMessageItem[] = [
    ...(params.text ? [{ type: WeixinMessageItemType.TEXT, text_item: { text: params.text } } as WeixinMessageItem] : []),
    buildMediaItem({ filePath: params.filePath, uploaded, kind, ...(voiceMeta ? { voiceMeta } : {}) }),
  ];
  let lastClientId = "";
  for (const item of itemList) {
    lastClientId = randomUUID();
    const resp = await sendWeixinMessageBody({
      body: {
        msg: {
          from_user_id: "",
          to_user_id: params.to,
          client_id: lastClientId,
          message_type: WeixinMessageType.BOT,
          message_state: WeixinMessageState.FINISH,
          item_list: [item],
          context_token: params.contextToken,
        },
      },
      options: {
        baseUrl: params.options.baseUrl || DEFAULT_WEIXIN_BASE_URL,
        token: params.options.token,
        fetchFn: params.options.fetchFn,
        timeoutMs: params.options.timeoutMs,
        channelVersion: params.options.channelVersion,
        botAgent: params.options.botAgent,
      },
    });
    const code = resp.errcode ?? resp.ret ?? 0;
    if (code !== 0) throw new Error(`Weixin sendmessage media error ${code}: ${resp.errmsg ?? "unknown error"}`);
  }
  return { messageId: lastClientId };
}

export const __testables = {
  encryptAesEcb,
  decryptAesEcb,
  aesEcbPaddedSize,
  parseAesKey,
  buildCdnDownloadUrl,
  buildCdnUploadUrl,
  parseOggOpusPlaytimeMs,
};

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { redactDiagnosticText } from "../../../privacy/diagnostic-redaction.js";
import type { AgentRunAcpAdapter } from "./adapter.js";

export interface AgentRunAcpHttpServerOptions {
  host?: string;
  port?: number;
  maxPayloadBytes?: number;
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
  };
  traceExport?: {
    enabled: boolean;
    maxEvents?: number;
    maxBytes?: number;
  };
}

class AcpHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;

interface RateBucket {
  windowStartMs: number;
  count: number;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const raw = req.headers.authorization;
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1];
}

async function readJson(req: IncomingMessage, maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
    throw new AcpHttpError(413, `ACP payload exceeds max_payload_bytes=${maxPayloadBytes}`);
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxPayloadBytes) {
      throw new AcpHttpError(413, `ACP payload exceeds max_payload_bytes=${maxPayloadBytes}`);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AcpHttpError(400, "Invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AcpHttpError(400, "Expected JSON object body");
  }
  return parsed as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function rateLimitKey(req: IncomingMessage, token: string | undefined): string {
  return `token:${token ?? "none"}|ip:${req.socket.remoteAddress ?? "unknown"}`;
}

function assertRateLimit(
  req: IncomingMessage,
  token: string | undefined,
  buckets: Map<string, RateBucket>,
  options: NonNullable<AgentRunAcpHttpServerOptions["rateLimit"]>
): void {
  const now = Date.now();
  const key = rateLimitKey(req, token);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartMs >= options.windowMs) {
    buckets.set(key, { windowStartMs: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > options.maxRequests) {
    throw new AcpHttpError(429, "ACP rate limit exceeded");
  }
}

export function createAgentRunAcpHttpServer(
  adapter: AgentRunAcpAdapter,
  options: AgentRunAcpHttpServerOptions = {},
): Server {
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const rateLimit = options.rateLimit ?? {
    windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    maxRequests: DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  };
  const rateBuckets = new Map<string, RateBucket>();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = bearerToken(req);
      assertRateLimit(req, token, rateBuckets, rateLimit);
      if (req.method === "GET" && url.pathname === "/manifest") {
        sendJson(res, 200, adapter.manifest(token));
        return;
      }
      if (req.method === "GET" && url.pathname === "/trace") {
        if (!options.traceExport?.enabled) throw new AcpHttpError(404, "trace_export_disabled");
        sendJson(res, 200, adapter.exportTrace({
          token,
          maxEvents: options.traceExport.maxEvents,
          maxBytes: options.traceExport.maxBytes,
        }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/runs") {
        const body = await readJson(req, maxPayloadBytes);
        sendJson(res, 200, adapter.createExternalRun({
          role: String(body.role ?? "external-agent"),
          ...(stringValue(body.parent_run_id) ? { parentRunId: stringValue(body.parent_run_id) } : {}),
          token,
        }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/messages") {
        const body = await readJson(req, maxPayloadBytes);
        sendJson(res, 200, adapter.postMessage({
          fromRunId: String(body.from_run_id ?? ""),
          ...(stringValue(body.to_run_id) ? { toRunId: stringValue(body.to_run_id) } : {}),
          kind: body.kind as never,
          ...(stringValue(body.content_text) ? { contentText: stringValue(body.content_text) } : {}),
          ...("payload" in body ? { payload: body.payload } : {}),
          ...(Array.isArray(body.artifact_ids) ? { artifactIds: body.artifact_ids.filter((id): id is string => typeof id === "string") } : {}),
          token,
        }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/mailbox") {
        sendJson(res, 200, adapter.readMailbox({
          runId: url.searchParams.get("run_id") ?? "",
          ...(url.searchParams.get("after_cursor") ? { afterCursor: url.searchParams.get("after_cursor") ?? undefined } : {}),
          token,
        }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/artifacts") {
        const body = await readJson(req, maxPayloadBytes);
        sendJson(res, 200, adapter.publishArtifact({
          runId: String(body.run_id ?? ""),
          kind: body.kind as never,
          ...(stringValue(body.title) ? { title: stringValue(body.title) } : {}),
          ...(stringValue(body.content) ? { content: stringValue(body.content) } : {}),
          ...(stringValue(body.path) ? { path: stringValue(body.path) } : {}),
          ...(stringValue(body.summary) ? { summary: stringValue(body.summary) } : {}),
          token,
        }));
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
        sendJson(res, 200, adapter.readArtifact({ artifactId: decodeURIComponent(url.pathname.slice("/artifacts/".length)), token }) ?? null);
        return;
      }
      if (req.method === "GET" && url.pathname === "/blackboard") {
        sendJson(res, 200, adapter.listBlackboard(token));
        return;
      }
      if (req.method === "POST" && url.pathname === "/blackboard") {
        const body = await readJson(req, maxPayloadBytes);
        sendJson(res, 200, adapter.upsertBlackboardFact({
          key: String(body.key ?? ""),
          content: String(body.content ?? ""),
          confidence: body.confidence as never,
          sourceMessageId: String(body.source_message_id ?? ""),
          token,
        }));
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      const status = err instanceof AcpHttpError ? err.status : 400;
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, status, { error: redactDiagnosticText(message, { maxChars: 240 }) });
    }
  });
}

export async function listenAgentRunAcpHttpServer(
  adapter: AgentRunAcpAdapter,
  options: AgentRunAcpHttpServerOptions = {},
): Promise<Server> {
  const server = createAgentRunAcpHttpServer(adapter, options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

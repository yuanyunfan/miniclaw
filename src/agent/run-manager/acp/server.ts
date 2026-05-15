import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { AgentRunAcpAdapter } from "./adapter.js";

export interface AgentRunAcpHttpServerOptions {
  host?: string;
  port?: number;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const raw = req.headers.authorization;
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1];
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object body");
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

export function createAgentRunAcpHttpServer(adapter: AgentRunAcpAdapter): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = bearerToken(req);
      if (req.method === "GET" && url.pathname === "/manifest") {
        sendJson(res, 200, adapter.manifest(token));
        return;
      }
      if (req.method === "POST" && url.pathname === "/runs") {
        const body = await readJson(req);
        sendJson(res, 200, adapter.createExternalRun({
          role: String(body.role ?? "external-agent"),
          ...(stringValue(body.parent_run_id) ? { parentRunId: stringValue(body.parent_run_id) } : {}),
          token,
        }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/messages") {
        const body = await readJson(req);
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
        const body = await readJson(req);
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
        const body = await readJson(req);
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
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export async function listenAgentRunAcpHttpServer(
  adapter: AgentRunAcpAdapter,
  options: AgentRunAcpHttpServerOptions = {},
): Promise<Server> {
  const server = createAgentRunAcpHttpServer(adapter);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

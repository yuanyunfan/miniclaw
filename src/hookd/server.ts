import { existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { recordCliSessionHookEvent, markDeadCliSessions } from "../store/db.js";
import { createLogger } from "../lib/log.js";
import { isCliSessionProvider, mapHookEventToPhase } from "./state.js";
import type { CliSessionHookEvent, CliSessionProvider } from "./types.js";
import { hookdApprovalRegistry } from "./approvals.js";

const log = createLogger("hookd");

export interface HookdRuntimeConfig {
  enabled: boolean;
  socketPath: string;
  maxPayloadBytes: number;
  zombieScanIntervalMs: number;
  approvalTimeoutMs: number;
}

export interface HookdRuntimeOptions {
  onSessionStateChanged?: () => Promise<unknown> | unknown;
}

export interface HookdHandle {
  socketPath: string;
  stop: () => Promise<void>;
  scanNow: () => number;
}

export interface HookdSocketServerOptions {
  socketPath: string;
  maxPayloadBytes?: number;
  onEvent?: (event: CliSessionHookEvent) => Promise<unknown> | unknown;
}

export interface HookdSocketServerHandle {
  socketPath: string;
  server: Server;
  stop: () => Promise<void>;
}

function prepareSocketPath(socketPath: string): void {
  mkdirSync(dirname(socketPath), { recursive: true });
  if (!existsSync(socketPath)) return;
  const stat = lstatSync(socketPath);
  if (!stat.isSocket()) {
    throw new Error(`hookd socket path exists and is not a socket: ${socketPath}`);
  }
  unlinkSync(socketPath);
}

function writeJson(socket: Socket, payload: unknown): void {
  socket.write(`${JSON.stringify(payload)}\n`);
}

function parseHookEvent(raw: unknown): CliSessionHookEvent {
  if (!raw || typeof raw !== "object") {
    throw new Error("hook event must be a JSON object");
  }
  const data = raw as Record<string, unknown>;
  const providerRaw = String(data.provider ?? data.source ?? "").toLowerCase();
  if (!isCliSessionProvider(providerRaw)) {
    throw new Error(`unsupported hook event provider: ${providerRaw || "(missing)"}`);
  }
  const provider = providerRaw as CliSessionProvider;
  const providerSessionId = String(
    data.providerSessionId ?? data.provider_session_id ?? data.session_id ?? data.sessionId ?? data.thread_id ?? ""
  ).trim();
  if (!providerSessionId) {
    throw new Error("hook event missing session id");
  }
  const eventName = String(data.eventName ?? data.event_name ?? data.hook_event_name ?? data.event ?? data.type ?? data.name ?? "").trim();
  if (!eventName) {
    throw new Error("hook event missing event name");
  }
  const cwd = String(data.cwd ?? process.cwd()).trim() || process.cwd();
  const pid = typeof data.pid === "number"
    ? data.pid
    : typeof data.parent_pid === "number"
      ? data.parent_pid
      : undefined;
  const phaseRaw = typeof data.phase === "string"
    ? data.phase
    : typeof data.status === "string"
      ? data.status
      : undefined;
  const terminalSurface = data.terminalSurface ?? data.terminal_surface;
  const toolInput = data.toolInput ?? data.tool_input;
  return {
    provider,
    providerSessionId,
    eventName,
    cwd,
    phase: mapHookEventToPhase(provider, eventName, phaseRaw),
    ...(Number.isInteger(pid) && Number(pid) > 0 ? { pid: Number(pid) } : {}),
    ...(typeof data.tty === "string" ? { tty: data.tty } : {}),
    ...(typeof data.terminalApp === "string" ? { terminalApp: data.terminalApp } : {}),
    ...(typeof data.terminal_app === "string" ? { terminalApp: data.terminal_app } : {}),
    ...(terminalSurface && typeof terminalSurface === "object" && !Array.isArray(terminalSurface)
      ? { terminalSurface: terminalSurface as Record<string, unknown> }
      : {}),
    ...(typeof data.transcriptPath === "string" ? { transcriptPath: data.transcriptPath } : {}),
    ...(typeof data.transcript_path === "string" ? { transcriptPath: data.transcript_path } : {}),
    ...(typeof data.transcriptActivity === "boolean" ? { transcriptActivity: data.transcriptActivity } : {}),
    ...(typeof data.transcript_activity === "boolean" ? { transcriptActivity: data.transcript_activity } : {}),
    ...(typeof data.prompt === "string" ? { prompt: data.prompt } : {}),
    ...(typeof data.summary === "string" ? { summary: data.summary } : {}),
    ...(typeof data.attentionKind === "string" ? { attentionKind: data.attentionKind } : {}),
    ...(typeof data.attention_kind === "string" ? { attentionKind: data.attention_kind } : {}),
    ...(typeof data.toolName === "string" ? { toolName: data.toolName } : {}),
    ...(typeof data.tool_name === "string" ? { toolName: data.tool_name } : {}),
    ...(typeof data.tool === "string" ? { toolName: data.tool } : {}),
    ...(toolInput !== undefined ? { toolInput } : {}),
    ...(typeof data.toolUseId === "string" ? { toolUseId: data.toolUseId } : {}),
    ...(typeof data.tool_use_id === "string" ? { toolUseId: data.tool_use_id } : {}),
    ...(typeof data.approvalRequestId === "string" ? { approvalRequestId: data.approvalRequestId } : {}),
    ...(typeof data.approval_request_id === "string" ? { approvalRequestId: data.approval_request_id } : {}),
    payload: data.payload ?? data,
    receivedAt: new Date(),
  };
}

function notifySessionStateChanged(callback: HookdRuntimeOptions["onSessionStateChanged"]): void {
  if (!callback) return;
  void Promise.resolve()
    .then(callback)
    .catch((err: unknown) => {
      log.warn("hookd session-state callback failed:", err);
    });
}

function createHookdEventHandler(options: { approvalTimeoutMs: number; onSessionStateChanged?: HookdRuntimeOptions["onSessionStateChanged"] }) {
  return async (event: CliSessionHookEvent) => {
    const row = recordCliSessionHookEvent(event);
    if (event.provider === "claude" && event.phase === "waiting_for_approval") {
      const result = hookdApprovalRegistry.requestApproval({
        session: row,
        event,
        timeoutMs: options.approvalTimeoutMs,
      });
      notifySessionStateChanged(options.onSessionStateChanged);
      try {
        return await result;
      } finally {
        notifySessionStateChanged(options.onSessionStateChanged);
      }
    }
    notifySessionStateChanged(options.onSessionStateChanged);
    return { sessionId: row.id };
  };
}

export function startHookdSocketServer(options: HookdSocketServerOptions): HookdSocketServerHandle {
  const maxPayloadBytes = options.maxPayloadBytes ?? 256 * 1024;
  const onEvent = options.onEvent ?? ((event: CliSessionHookEvent) => recordCliSessionHookEvent(event));
  prepareSocketPath(options.socketPath);

  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > maxPayloadBytes) {
        writeJson(socket, { ok: false, error: "payload_too_large" });
        socket.end();
        return;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        void Promise.resolve()
          .then(() => JSON.parse(trimmed) as unknown)
          .then(parseHookEvent)
          .then(onEvent)
          .then((result) => writeJson(socket, { ok: true, result }))
          .catch((err: unknown) => {
            writeJson(socket, { ok: false, error: err instanceof Error ? err.message : String(err) });
          });
      }
    });
  });

  server.listen(options.socketPath);
  return {
    socketPath: options.socketPath,
    server,
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (existsSync(options.socketPath)) {
          try {
            if (lstatSync(options.socketPath).isSocket()) unlinkSync(options.socketPath);
          } catch {
            // Best-effort socket cleanup only.
          }
        }
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}

export function startHookd(config: HookdRuntimeConfig, options: HookdRuntimeOptions = {}): HookdHandle | null {
  if (!config.enabled) return null;
  const expired = hookdApprovalRegistry.expireStartupPending();
  if (expired > 0) log.info(`hookd expired ${expired} pending approval request(s) on startup`);
  const socket = startHookdSocketServer({
    socketPath: config.socketPath,
    maxPayloadBytes: config.maxPayloadBytes,
    onEvent: createHookdEventHandler({
      approvalTimeoutMs: config.approvalTimeoutMs,
      onSessionStateChanged: options.onSessionStateChanged,
    }),
  });
  const interval = setInterval(() => {
    const ended = markDeadCliSessions();
    if (ended > 0) {
      log.info(`hookd marked ${ended} dead CLI session(s) ended`);
      notifySessionStateChanged(options.onSessionStateChanged);
    }
  }, config.zombieScanIntervalMs);
  interval.unref();
  log.info(`hookd listening on ${config.socketPath}`);

  return {
    socketPath: config.socketPath,
    scanNow: () => {
      const ended = markDeadCliSessions();
      if (ended > 0) notifySessionStateChanged(options.onSessionStateChanged);
      return ended;
    },
    stop: async () => {
      clearInterval(interval);
      await socket.stop();
      log.info("hookd stopped");
    },
  };
}

export const __testables = {
  parseHookEvent,
};

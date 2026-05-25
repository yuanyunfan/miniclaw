import { existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { recordCliSessionHookEvent, markDeadCliSessions } from "../store/db.js";
import { createLogger } from "../lib/log.js";
import { isCliSessionProvider, mapHookEventToPhase } from "./state.js";
import type { CliSessionHookEvent, CliSessionProvider } from "./types.js";

const log = createLogger("hookd");

export interface HookdRuntimeConfig {
  enabled: boolean;
  socketPath: string;
  maxPayloadBytes: number;
  zombieScanIntervalMs: number;
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
  const eventName = String(data.eventName ?? data.event_name ?? data.hook_event_name ?? data.type ?? data.name ?? "").trim();
  if (!eventName) {
    throw new Error("hook event missing event name");
  }
  const cwd = String(data.cwd ?? process.cwd()).trim() || process.cwd();
  const pid = typeof data.pid === "number"
    ? data.pid
    : typeof data.parent_pid === "number"
      ? data.parent_pid
      : undefined;
  const phaseRaw = typeof data.phase === "string" ? data.phase : undefined;
  const terminalSurface = data.terminalSurface ?? data.terminal_surface;
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
    payload: data.payload ?? data,
    receivedAt: new Date(),
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

export function startHookd(config: HookdRuntimeConfig): HookdHandle | null {
  if (!config.enabled) return null;
  const socket = startHookdSocketServer({
    socketPath: config.socketPath,
    maxPayloadBytes: config.maxPayloadBytes,
  });
  const interval = setInterval(() => {
    const ended = markDeadCliSessions();
    if (ended > 0) log.info(`hookd marked ${ended} dead CLI session(s) ended`);
  }, config.zombieScanIntervalMs);
  interval.unref();
  log.info(`hookd listening on ${config.socketPath}`);

  return {
    socketPath: config.socketPath,
    scanNow: () => markDeadCliSessions(),
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

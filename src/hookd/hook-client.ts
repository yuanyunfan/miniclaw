#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { sendHookdEvent } from "./transport.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseStdinJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("hook stdin payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function normalizedEventName(raw: Record<string, unknown>): string {
  return String(raw.eventName ?? raw.event_name ?? raw.hook_event_name ?? raw.event ?? raw.type ?? raw.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function psValue(pid: number, field: string): string | undefined {
  try {
    const value = execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function terminalSurfaceFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  return {
    ...(env.ITERM_SESSION_ID ? { iterm_session_id: env.ITERM_SESSION_ID } : {}),
    ...(env.TERM_PROGRAM ? { term_program: env.TERM_PROGRAM } : {}),
    ...(env.TMUX ? { tmux: env.TMUX } : {}),
    ...(env.CMUX_WORKSPACE_ID ? { cmux_workspace_id: env.CMUX_WORKSPACE_ID } : {}),
    ...(env.CMUX_SURFACE_ID ? { cmux_surface_id: env.CMUX_SURFACE_ID } : {}),
  };
}

export function normalizeProviderHookPayload(input: {
  provider: string;
  raw: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  parentPid?: number;
  cwd?: string;
}): Record<string, unknown> {
  const env = input.env ?? process.env;
  const parentPid = input.parentPid ?? process.ppid;
  const terminalSurface = terminalSurfaceFromEnv(env);
  const provider = input.provider.toLowerCase();
  const eventName = input.raw.eventName
    ?? input.raw.event_name
    ?? input.raw.hook_event_name
    ?? input.raw.event
    ?? input.raw.type
    ?? input.raw.name
    ?? "unknown";
  const sessionId = input.raw.providerSessionId
    ?? input.raw.provider_session_id
    ?? input.raw.session_id
    ?? input.raw.sessionId
    ?? input.raw.thread_id;

  return {
    ...input.raw,
    provider,
    source: provider,
    providerSessionId: sessionId,
    eventName,
    cwd: input.raw.cwd ?? input.cwd ?? process.cwd(),
    pid: parentPid,
    tty: input.raw.tty ?? psValue(parentPid, "tty"),
    terminalApp: input.raw.terminalApp ?? input.raw.terminal_app ?? env.TERM_PROGRAM,
    terminalSurface,
    transcriptPath: input.raw.transcriptPath ?? input.raw.transcript_path,
    toolName: input.raw.toolName ?? input.raw.tool_name ?? input.raw.tool,
    toolInput: input.raw.toolInput ?? input.raw.tool_input,
    toolUseId: input.raw.toolUseId ?? input.raw.tool_use_id,
    approvalRequestId: input.raw.approvalRequestId ?? input.raw.approval_request_id,
    payload: input.raw,
  };
}

export function claudePermissionResponse(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const approval = (result as { approval?: unknown }).approval ?? result;
  if (!approval || typeof approval !== "object") return null;
  const decision = String((approval as { decision?: unknown }).decision ?? "ask");
  const reason = typeof (approval as { reason?: unknown }).reason === "string"
    ? String((approval as { reason?: unknown }).reason)
    : "";
  if (decision === "allow") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    };
  }
  if (decision === "deny") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: reason || "Denied by MiniClaw",
        },
      },
    };
  }
  return null;
}

async function main(): Promise<void> {
  const provider = argValue("--provider") ?? process.env.MINICLAW_HOOKD_PROVIDER;
  if (!provider) throw new Error("missing --provider claude|codex");
  const socketPath = argValue("--socket")
    ?? process.env.MINICLAW_HOOKD_SOCKET
    ?? join(homedir(), ".miniclaw", "runtime", "hookd.sock");
  const timeoutMs = Number(argValue("--timeout-ms") ?? process.env.MINICLAW_HOOKD_TIMEOUT_MS ?? "5000");
  const raw = parseStdinJson(await readStdin());
  const event = normalizeProviderHookPayload({ provider, raw });
  const result = await sendHookdEvent(socketPath, event, timeoutMs);
  if (provider.toLowerCase() === "claude" && normalizedEventName(raw) === "permissionrequest") {
    const response = claudePermissionResponse(result);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

if (process.argv[1]?.endsWith("hook-client.ts") || process.argv[1]?.endsWith("hook-client.js")) {
  main().catch((err) => {
    process.stderr.write(`miniclaw hook-client error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}

import { execFile as execFileCallback, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import type { CliSessionRow } from "./types.js";

const execFileAsync = promisify(execFileCallback) as (
  file: string,
  args: readonly string[],
  options: ExecFileOptions & { encoding: "utf8" },
) => Promise<{ stdout: string; stderr: string }>;

const LIST_ITERM_SESSIONS_SCRIPT = `
tell application "iTerm2"
  set out to {}
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        set end of out to ((id of s as text) & "|" & (tty of s as text))
      end repeat
    end repeat
  end repeat
  return out
end tell
`;

const SEND_ITERM_TEXT_SCRIPT = `
on run argv
  set targetId to item 1 of argv
  set textToSend to item 2 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s as text) is targetId then
            tell s to write text textToSend newline true
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "iTerm2 session not found: " & targetId number 404
end run
`;

export interface ItermSessionTarget {
  id: string;
  tty: string | null;
}

export type LiveTerminalInputFailureCode =
  | "disabled"
  | "not_idle"
  | "ended"
  | "hidden"
  | "missing_pid"
  | "pid_dead"
  | "unsupported_terminal"
  | "missing_target"
  | "target_lookup_failed"
  | "target_not_found"
  | "target_ambiguous"
  | "target_mismatch"
  | "send_failed";

export type LiveTerminalInputResult =
  | { ok: true; target: ItermSessionTarget }
  | { ok: false; code: LiveTerminalInputFailureCode; message: string; target?: ItermSessionTarget };

export interface LiveTerminalInputDependencies {
  listItermSessions?: () => Promise<ItermSessionTarget[]>;
  sendTextToItermSession?: (sessionId: string, text: string) => Promise<void>;
  isPidAlive?: (pid: number) => boolean;
}

export interface LiveTerminalEligibilityOptions {
  enabled?: boolean;
}

function failure(code: LiveTerminalInputFailureCode, message: string, target?: ItermSessionTarget): LiveTerminalInputResult {
  return target ? { ok: false, code, message, target } : { ok: false, code, message };
}

function normalizeItermSessionId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

export function normalizeTty(tty: string | null | undefined): string | undefined {
  const trimmed = tty?.trim();
  if (!trimmed || trimmed === "??") return undefined;
  return trimmed.startsWith("/dev/") ? trimmed : `/dev/${trimmed}`;
}

function parseTerminalSurface(json: string | null): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export function extractItermSessionGuid(terminalSurfaceJson: string | null): string | undefined {
  const surface = parseTerminalSurface(terminalSurfaceJson);
  const raw = stringValue(surface, "iterm_session_id");
  if (!raw) return undefined;
  const guid = raw.includes(":") ? raw.split(":").at(-1) : raw;
  return normalizeItermSessionId(guid);
}

function includesIterm(value: string | null | undefined): boolean {
  return Boolean(value?.toLowerCase().includes("iterm"));
}

function hasItermTargetHint(session: CliSessionRow): boolean {
  const surface = parseTerminalSurface(session.terminal_surface_json);
  return Boolean(
    extractItermSessionGuid(session.terminal_surface_json) ||
    includesIterm(session.terminal_app) ||
    includesIterm(stringValue(surface, "term_program")) ||
    (!session.terminal_app && normalizeTty(session.tty))
  );
}

export function getCliSessionLiveTerminalEligibility(
  session: CliSessionRow,
  options: LiveTerminalEligibilityOptions = {},
): LiveTerminalInputResult {
  if (options.enabled === false) {
    return failure("disabled", "Live terminal Continue is disabled.");
  }
  if (session.phase !== "waiting_for_input") {
    return failure("not_idle", "This session is not idle.");
  }
  if (session.ended_at) {
    return failure("ended", "This session has already ended.");
  }
  if (session.hidden_at) {
    return failure("hidden", "This session is hidden.");
  }
  if (!Number.isInteger(session.pid) || Number(session.pid) <= 0) {
    return failure("missing_pid", "This session does not have a live process id.");
  }
  if (!hasItermTargetHint(session)) {
    return failure("unsupported_terminal", "This session is not an iTerm2-backed session.");
  }
  if (!extractItermSessionGuid(session.terminal_surface_json) && !normalizeTty(session.tty)) {
    return failure("missing_target", "This session does not have an iTerm2 session id or tty.");
  }
  return { ok: true, target: { id: extractItermSessionGuid(session.terminal_surface_json) ?? "", tty: normalizeTty(session.tty) ?? null } };
}

export function isCliSessionLiveTerminalEligible(
  session: CliSessionRow,
  options: LiveTerminalEligibilityOptions = {},
): boolean {
  return getCliSessionLiveTerminalEligibility(session, options).ok;
}

export function parseItermSessionList(output: string): ItermSessionTarget[] {
  return output
    .split(/,\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, tty] = line.split("|");
      return {
        id: normalizeItermSessionId(id) ?? "",
        tty: normalizeTty(tty) ?? null,
      };
    })
    .filter((target) => Boolean(target.id));
}

export async function listItermSessions(): Promise<ItermSessionTarget[]> {
  const { stdout } = await execFileAsync("osascript", ["-e", LIST_ITERM_SESSIONS_SCRIPT], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  return parseItermSessionList(stdout);
}

export async function sendTextToItermSession(sessionId: string, text: string): Promise<void> {
  await execFileAsync("osascript", ["-e", SEND_ITERM_TEXT_SCRIPT, sessionId, text], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function resolveItermTarget(
  session: CliSessionRow,
  dependencies: Pick<LiveTerminalInputDependencies, "listItermSessions"> = {},
): Promise<LiveTerminalInputResult> {
  const desiredId = extractItermSessionGuid(session.terminal_surface_json);
  const desiredTty = normalizeTty(session.tty);
  if (!desiredId && !desiredTty) {
    return failure("missing_target", "This session does not have an iTerm2 session id or tty.");
  }

  let targets: ItermSessionTarget[];
  try {
    targets = await (dependencies.listItermSessions ?? listItermSessions)();
  } catch {
    return failure("target_lookup_failed", "Could not inspect iTerm2 sessions.");
  }

  if (desiredId) {
    const target = targets.find((item) => item.id === desiredId);
    if (!target) {
      return failure("target_not_found", "The original iTerm2 session is no longer available.");
    }
    if (desiredTty && target.tty && target.tty !== desiredTty) {
      return failure("target_mismatch", "The iTerm2 session id no longer matches the recorded tty.", target);
    }
    return { ok: true, target };
  }

  const matches = targets.filter((item) => item.tty && item.tty === desiredTty);
  if (matches.length === 0) {
    return failure("target_not_found", "No iTerm2 session matches the recorded tty.");
  }
  if (matches.length > 1) {
    return failure("target_ambiguous", "Multiple iTerm2 sessions match the recorded tty.");
  }
  return { ok: true, target: matches[0] as ItermSessionTarget };
}

export async function sendCliSessionLiveTerminalInput(
  session: CliSessionRow,
  text: string,
  dependencies: LiveTerminalInputDependencies = {},
): Promise<LiveTerminalInputResult> {
  const eligible = getCliSessionLiveTerminalEligibility(session);
  if (!eligible.ok) return eligible;

  const isPidAlive = dependencies.isPidAlive ?? defaultPidAlive;
  if (session.pid === null || !isPidAlive(session.pid)) {
    return failure("pid_dead", "The recorded CLI process is no longer alive.");
  }

  const resolved = await resolveItermTarget(session, dependencies);
  if (!resolved.ok) return resolved;

  try {
    await (dependencies.sendTextToItermSession ?? sendTextToItermSession)(resolved.target.id, text);
  } catch {
    return failure("send_failed", "Failed to send text to the iTerm2 session.", resolved.target);
  }
  return resolved;
}

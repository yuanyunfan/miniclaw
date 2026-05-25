import type { ModalSubmitInteraction } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliSessionRow } from "../../hookd/types.js";

vi.mock("../../config.js", () => ({
  config: {
    allowedUserId: "user-1",
    hookd: { liveTerminalContinueEnabled: true },
  },
}));

vi.mock("../../store/db.js", () => ({
  getCliSession: vi.fn(),
  markCliSessionEnded: vi.fn(),
}));

vi.mock("../../hookd/live-terminal-input.js", () => ({
  sendCliSessionLiveTerminalInput: vi.fn(),
}));

vi.mock("../cli-session-buttons.js", () => ({
  requestCliSessionDashboardRefresh: vi.fn(),
}));

vi.mock("../../lib/log.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { handleCliSessionModal } = await import("../cli-session-modals.js");
const { getCliSession, markCliSessionEnded } = await import("../../store/db.js");
const { sendCliSessionLiveTerminalInput } = await import("../../hookd/live-terminal-input.js");
const { requestCliSessionDashboardRefresh } = await import("../cli-session-buttons.js");

function session(overrides: Partial<CliSessionRow> = {}): CliSessionRow {
  return {
    id: "session-12345678",
    provider: "codex",
    provider_session_id: "provider-session-1",
    cwd: "/repo",
    pid: 123,
    tty: "ttys001",
    terminal_app: "iTerm.app",
    terminal_surface_json: JSON.stringify({
      iterm_session_id: "w0t0p0:B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA",
      term_program: "iTerm.app",
    }),
    transcript_path: null,
    phase: "waiting_for_input",
    attention_kind: null,
    latest_summary: null,
    latest_prompt: "next step",
    last_event_name: "Stop",
    last_activity_at: "2026-05-25T00:00:00.000Z",
    started_at: "2026-05-25T00:00:00.000Z",
    ended_at: null,
    hidden_at: null,
    observed_prompt_count: 1,
    transcript_activity_at: null,
    ...overrides,
  };
}

function modalInteraction(followup: string): {
  interaction: ModalSubmitInteraction;
  reply: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn(async (_payload: unknown) => undefined);
  return {
    interaction: {
      customId: "miniclaw:cli-session:continue-submit:session-12345678",
      user: { id: "user-1" },
      fields: {
        getTextInputValue: vi.fn(() => followup),
      },
      reply,
    } as unknown as ModalSubmitInteraction,
    reply,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleCliSessionModal", () => {
  it("sends follow-up text to the live iTerm2 session without creating a Discord task thread", async () => {
    const row = session({
      provider: "claude",
      provider_session_id: "claude-session-1",
    });
    vi.mocked(getCliSession).mockReturnValue(row);
    vi.mocked(sendCliSessionLiveTerminalInput).mockResolvedValue({
      ok: true,
      target: { id: "B1BE6CD2-5C56-4D6D-BD4F-2187F6443FDA", tty: "/dev/ttys001" },
    });
    const { interaction, reply } = modalInteraction("continue in terminal");

    await expect(handleCliSessionModal(interaction)).resolves.toBe(true);

    expect(sendCliSessionLiveTerminalInput).toHaveBeenCalledWith(row, "continue in terminal");
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("Sent follow-up to iTerm2 session"),
      ephemeral: true,
    }));
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("for claude CLI session"),
    }));
    expect(requestCliSessionDashboardRefresh).toHaveBeenCalledOnce();
  });

  it("marks the session ended when live input detects a dead pid", async () => {
    vi.mocked(getCliSession).mockReturnValue(session());
    vi.mocked(sendCliSessionLiveTerminalInput).mockResolvedValue({
      ok: false,
      code: "pid_dead",
      message: "The recorded CLI process is no longer alive.",
    });
    const { interaction, reply } = modalInteraction("continue in terminal");

    await expect(handleCliSessionModal(interaction)).resolves.toBe(true);

    expect(markCliSessionEnded).toHaveBeenCalledWith("session-12345678", "pid_dead");
    expect(requestCliSessionDashboardRefresh).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("Could not send follow-up"),
      ephemeral: true,
    }));
  });
});

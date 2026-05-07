import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isEmailMessageSeen, loadEmailState, markEmailMessagesSeen, saveEmailState } from "../state.js";
import type { EmailMessage } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-email-state-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const message: EmailMessage = {
  id: "m1",
  profile: "p",
  folder: "INBOX",
  provider_uid: "42",
  message_id_hash: "sha256:message",
  received_at: "2026-05-07T10:00:00.000Z",
  from: { address: "notice@example.com" },
  to: [],
  subject: "通知",
  attachments: [],
};

describe("email state", () => {
  it("tracks seen messages for dedupe", () => {
    const path = join(tmp, "state.json");
    const state = loadEmailState(path);

    expect(isEmailMessageSeen(state, message)).toBe(false);
    markEmailMessagesSeen(state, [message]);
    saveEmailState(path, state);

    expect(isEmailMessageSeen(loadEmailState(path), message)).toBe(true);
  });
});

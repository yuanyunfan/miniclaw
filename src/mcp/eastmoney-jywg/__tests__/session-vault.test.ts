import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCookieHeader,
  filterJywgCookies,
  loadEastmoneyJywgSession,
  mergeSessionCookies,
  saveEastmoneyJywgSession,
} from "../session-vault.js";
import type { EastmoneyJywgSession } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-eastmoney-session-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const session: EastmoneyJywgSession = {
  version: 1,
  host: "jywg.18.cn",
  created_at: "2026-05-08T00:00:00.000Z",
  source: "test",
  cookies: [
    { name: "jywg", value: "cookie", domain: ".18.cn", path: "/", secure: true, httpOnly: true },
  ],
};

describe("eastmoney-jywg session vault", () => {
  it("saves and loads session files with 0600 permissions", () => {
    const path = join(tmp, "session.json");
    saveEastmoneyJywgSession(path, session);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadEastmoneyJywgSession(path)).toMatchObject({
      version: 1,
      host: "jywg.18.cn",
      cookies: [{ name: "jywg", value: "cookie" }],
    });
  });

  it("rejects too-open session file permissions on Unix platforms", () => {
    const path = join(tmp, "session.json");
    saveEastmoneyJywgSession(path, session);
    chmodSync(path, 0o644);

    if (process.platform !== "win32") {
      expect(() => loadEastmoneyJywgSession(path)).toThrow(/0600/);
    }
  });

  it("builds cookie headers from filtered jywg cookies only", () => {
    const cookies = filterJywgCookies([
      { name: "ok", value: "1", domain: ".18.cn" },
      { name: "other", value: "2", domain: ".example.com" },
    ]);

    expect(cookies).toHaveLength(1);
    expect(buildCookieHeader(cookies)).toBe("ok=1");
  });

  it("merges response cookies by name, domain, and path", () => {
    const merged = mergeSessionCookies(session, [
      { name: "jywg", value: "new", domain: ".18.cn", path: "/" },
      { name: "ignored", value: "x", domain: ".example.com", path: "/" },
    ]);

    expect(merged.cookies).toHaveLength(1);
    expect(merged.cookies[0].value).toBe("new");
  });
});

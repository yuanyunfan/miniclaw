import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCookieHeader,
  filterMyfavorCookies,
  loadEastmoneyMyfavorSession,
  saveEastmoneyMyfavorSession,
  touchSession,
} from "../session-vault.js";
import type { EastmoneyMyfavorSession } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-eastmoney-myfavor-session-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const session: EastmoneyMyfavorSession = {
  version: 1,
  host: "myfavor.eastmoney.com",
  created_at: "2026-05-13T00:00:00.000Z",
  source: "test",
  cookies: [
    { name: "sid", value: "cookie", domain: ".eastmoney.com", path: "/", secure: true, httpOnly: true },
  ],
};

describe("eastmoney-myfavor session vault", () => {
  it("saves and loads session files with 0600 permissions", () => {
    const path = join(tmp, "session.json");
    saveEastmoneyMyfavorSession(path, session);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadEastmoneyMyfavorSession(path)).toMatchObject({
      version: 1,
      host: "myfavor.eastmoney.com",
      cookies: [{ name: "sid", value: "cookie" }],
    });
  });

  it("rejects too-open session file permissions on Unix platforms", () => {
    const path = join(tmp, "session.json");
    saveEastmoneyMyfavorSession(path, session);
    chmodSync(path, 0o644);

    if (process.platform !== "win32") {
      expect(() => loadEastmoneyMyfavorSession(path)).toThrow(/0600/);
    }
  });

  it("builds cookie headers from filtered myfavor cookies only", () => {
    const cookies = filterMyfavorCookies([
      { name: "myfavor", value: "1", domain: "myfavor.eastmoney.com" },
      { name: "root", value: "2", domain: ".eastmoney.com" },
      { name: "other", value: "3", domain: ".example.com" },
    ]);

    expect(cookies).toHaveLength(2);
    expect(buildCookieHeader(cookies)).toBe("myfavor=1; root=2");
  });

  it("touches the session without changing cookies", () => {
    const touched = touchSession(session, new Date("2026-05-13T01:02:03.000Z"));

    expect(touched.last_verified_at).toBe("2026-05-13T01:02:03.000Z");
    expect(touched.cookies).toEqual(session.cookies);
  });
});

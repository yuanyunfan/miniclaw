import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEmailConfig, loadEmailSecret, resolveEmailProfile } from "../config.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-email-config-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("email config", () => {
  it("loads IMAP profile and keeps secrets out of YAML", () => {
    const secret = join(tmp, "secret.json");
    writeFileSync(secret, JSON.stringify({ username: "notify@example.com", password: "app-password" }));
    const configPath = join(tmp, "email.yaml");
    writeFileSync(configPath, `
profiles:
  cmb-notify:
    provider: imap
    account_alias: cmb
    secret_path: "${secret}"
    folders: ["INBOX"]
    allowed_senders: ["*.cmbchina.com"]
    subject_allowlist: ["信用卡"]
    imap:
      host: imap.example.com
      port: 993
      secure: true
`);

    const config = loadEmailConfig(configPath);
    const profile = resolveEmailProfile(config, "cmb-notify");

    expect(profile.secret_path).toBe(secret);
    expect(profile.imap?.host).toBe("imap.example.com");
    expect(profile.allowed_senders).toEqual(["*.cmbchina.com"]);
    expect(JSON.stringify(profile)).not.toContain("app-password");
    expect(loadEmailSecret(profile).password).toBe("app-password");
  });

  it("rejects IMAP profiles without host", () => {
    const configPath = join(tmp, "bad.yaml");
    writeFileSync(configPath, `
profiles:
  bad:
    provider: imap
`);

    expect(() => loadEmailConfig(configPath)).toThrow("imap.host");
  });
});

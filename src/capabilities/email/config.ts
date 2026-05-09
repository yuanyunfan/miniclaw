import { chmodSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type {
  EmailAttachmentPolicy,
  EmailConfig,
  EmailProvider,
  EmailProfileConfig,
  EmailRawBodyRetention,
  EmailRedactionLevel,
  EmailSecret,
} from "./types.js";

const DEFAULT_CONFIG_PATH = "~/.miniclaw/capabilities/email/config.yaml";
const DEFAULT_STATE_DIR = "~/.miniclaw/capabilities/email";

export function resolveEmailHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function providerValue(value: unknown): EmailProvider {
  if (value === "imap" || value === "gmail" || value === "graph") return value;
  return "imap";
}

function redactionValue(value: unknown): EmailRedactionLevel {
  if (value === "strict" || value === "summary") return value;
  return "strict";
}

function rawBodyRetentionValue(value: unknown): EmailRawBodyRetention {
  if (value === undefined || value === "none") return "none";
  throw new Error("email profile raw_body_retention currently only supports 'none'");
}

function attachmentPolicyValue(value: unknown): EmailAttachmentPolicy {
  if (value === "download_allowlist") return "download_allowlist";
  if (value === "metadata_only") return "metadata_only";
  return "none";
}

function parseProfile(raw: unknown, name: string): EmailProfileConfig {
  if (!isPlainObject(raw)) throw new Error(`email profile '${name}' must be a YAML object`);
  const provider = providerValue(raw.provider);
  const statePath = stringValue(raw.state_path, `${DEFAULT_STATE_DIR}/${name}-state.json`);
  const profile: EmailProfileConfig = {
    name,
    provider,
    account_alias: stringValue(raw.account_alias, name),
    secret_path: optionalString(raw.secret_path),
    folders: stringArray(raw.folders, ["INBOX"]),
    allowed_senders: stringArray(raw.allowed_senders),
    subject_allowlist: stringArray(raw.subject_allowlist),
    max_lookback_days: positiveInt(raw.max_lookback_days, 7),
    max_results: positiveInt(raw.max_results, 50),
    body_max_bytes: positiveInt(raw.body_max_bytes, 512_000),
    raw_body_retention: rawBodyRetentionValue(raw.raw_body_retention),
    attachment_policy: attachmentPolicyValue(raw.attachment_policy),
    redaction: redactionValue(raw.redaction),
    state_path: statePath,
  };

  if (provider === "imap") {
    const imapRaw = isPlainObject(raw.imap) ? raw.imap : {};
    const host = optionalString(imapRaw.host);
    if (!host) throw new Error(`email profile '${name}' provider=imap requires imap.host`);
    profile.imap = {
      host,
      port: positiveInt(imapRaw.port, 993),
      secure: boolValue(imapRaw.secure, true),
      user: optionalString(imapRaw.user),
      login_method: optionalString(imapRaw.login_method),
      tls_reject_unauthorized: boolValue(imapRaw.tls_reject_unauthorized, true),
    };
  }

  return profile;
}

export function getEmailConfigPath(): string {
  return resolveEmailHome(process.env.MINICLAW_EMAIL_CONFIG ?? DEFAULT_CONFIG_PATH);
}

export function loadEmailConfig(path = getEmailConfigPath()): EmailConfig {
  if (!existsSync(path)) return { profiles: {} };
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`email config must be a YAML object: ${path}`);
  const rawProfiles = raw.profiles;
  if (!isPlainObject(rawProfiles)) throw new Error(`email config must include profiles: ${path}`);
  const profiles: Record<string, EmailProfileConfig> = {};
  for (const [name, profileRaw] of Object.entries(rawProfiles)) {
    const normalized = name.trim();
    if (!normalized || normalized.includes("/") || normalized.includes("..")) {
      throw new Error("email profile names must not be empty or include path separators");
    }
    profiles[normalized] = parseProfile(profileRaw, normalized);
  }
  return { profiles };
}

export function resolveEmailProfile(config: EmailConfig, name: string): EmailProfileConfig {
  const profileName = name.trim();
  if (!profileName || profileName.includes("/") || profileName.includes("..")) {
    throw new Error("email profile name must not be empty or include path separators");
  }
  const profile = config.profiles[profileName];
  if (!profile) throw new Error(`unknown email profile: ${profileName}`);
  return profile;
}

export function loadEmailSecret(profile: EmailProfileConfig): EmailSecret {
  if (!profile.secret_path) {
    if (profile.provider === "imap" && profile.imap?.user) return { username: profile.imap.user };
    throw new Error(`email profile '${profile.name}' requires secret_path`);
  }
  const path = resolveEmailHome(profile.secret_path);
  if (!existsSync(path)) throw new Error(`email secret file not found for profile '${profile.name}': ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`email secret must be a JSON object: ${path}`);
  return raw as EmailSecret;
}

export function chmodEmailSecretPath(path: string): void {
  chmodSync(resolveEmailHome(path), 0o600);
}

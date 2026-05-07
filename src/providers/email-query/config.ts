import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { load as yamlLoad } from "js-yaml";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/email-query");

export interface EmailQueryProviderConfig {
  email_profile: string;
  state_path: string;
  folders: string[];
  from: string[];
  subject_includes: string[];
  window_hours: number;
  max_results: number;
  include_body: boolean;
  include_attachments: boolean;
  dedupe: boolean;
}

function resolveHome(path: string): string {
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function configDir(): string {
  return process.env.MINICLAW_EMAIL_QUERY_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

export function getEmailQueryProviderConfigPath(name = "default"): string {
  if (name.includes("/") || name.includes("..")) {
    throw new Error("email-query config name must not include path separators");
  }
  return join(configDir(), `${name}.yaml`);
}

export function loadEmailQueryProviderConfig(name = "default"): EmailQueryProviderConfig {
  const path = getEmailQueryProviderConfigPath(name);
  if (!existsSync(path)) throw new Error(`email-query config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`email-query config must be a YAML object: ${path}`);
  const emailProfile = stringValue(raw.email_profile, "");
  if (!emailProfile) throw new Error("email-query config requires email_profile");
  return {
    email_profile: emailProfile,
    state_path: stringValue(raw.state_path, `~/.miniclaw/providers/email-query/${name}-state.json`),
    folders: stringArray(raw.folders),
    from: stringArray(raw.from),
    subject_includes: stringArray(raw.subject_includes),
    window_hours: positiveInt(raw.window_hours, 24),
    max_results: positiveInt(raw.max_results, 20),
    include_body: boolValue(raw.include_body, false),
    include_attachments: boolValue(raw.include_attachments, false),
    dedupe: boolValue(raw.dedupe, true),
  };
}

export const __testables = { resolveHome };

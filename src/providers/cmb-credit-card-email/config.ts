import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { CmbCreditCardEmailConfig } from "./types.js";

const CONFIG_DIR_DEFAULT = join(homedir(), ".miniclaw/providers/cmb-credit-card-email");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function configDir(): string {
  return process.env.MINICLAW_CMB_CREDIT_CARD_EMAIL_CONFIG_DIR ?? CONFIG_DIR_DEFAULT;
}

export function getCmbCreditCardEmailConfigPath(name = "default"): string {
  if (name.includes("/") || name.includes("..")) {
    throw new Error("cmb-credit-card-email config name must not include path separators");
  }
  return join(configDir(), `${name}.yaml`);
}

export function loadCmbCreditCardEmailConfig(name = "default"): CmbCreditCardEmailConfig {
  const path = getCmbCreditCardEmailConfigPath(name);
  if (!existsSync(path)) throw new Error(`cmb-credit-card-email config not found: ${path}`);
  const raw = yamlLoad(readFileSync(path, "utf8")) as unknown;
  if (!isPlainObject(raw)) throw new Error(`cmb-credit-card-email config must be a YAML object: ${path}`);
  const emailProfile = stringValue(raw.email_profile, "");
  if (!emailProfile) throw new Error("cmb-credit-card-email config requires email_profile");
  return {
    email_profile: emailProfile,
    state_path: stringValue(raw.state_path, `~/.miniclaw/providers/cmb-credit-card-email/${name}-state.json`),
    folders: stringArray(raw.folders, ["INBOX"]),
    from: stringArray(raw.from),
    subject_includes: stringArray(raw.subject_includes, ["信用卡", "消费", "账单", "招商"]),
    window_hours: positiveInt(raw.window_hours, 24),
    max_results: positiveInt(raw.max_results, 50),
    currency: stringValue(raw.currency, "CNY"),
    large_transaction_threshold: positiveNumber(raw.large_transaction_threshold, 1000),
    dedupe: boolValue(raw.dedupe, true),
  };
}

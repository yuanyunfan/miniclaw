import type { ClaudeSettingSource, ConfigObject, ConfigPath, ConfigPathInput } from "./types.js";
import { claudeSettingSourceValues, isPlainObject } from "./schema.js";

export interface ConfigReader {
  getPath(path: ConfigPath): unknown;
  readRaw(paths: ConfigPathInput, envKeys: string | readonly string[], fallback?: unknown): unknown;
  scalarString(raw: unknown, name: string): string | undefined;
  requiredString(paths: ConfigPathInput, envKeys: string | readonly string[], fallback?: string): string;
  optionalString(paths: ConfigPathInput, envKeys: string | readonly string[]): string | undefined;
  stringOrInherit(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: string): string | undefined;
  oneOf<T extends string>(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: T, allowed: readonly T[]): T;
  oneOfOrInherit<T extends string>(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: T, allowed: readonly T[]): T | undefined;
  boolValue(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: boolean): boolean;
  boolOrInherit(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: boolean): boolean | undefined;
  stringArray(paths: ConfigPathInput, envKeys: string | readonly string[], fallback?: readonly string[]): string[];
  settingSources(paths: ConfigPath, envKeys: string | readonly string[], fallback: readonly string[]): ClaudeSettingSource[];
  positiveNumber(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number;
  nonNegativeNumber(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number;
  confidenceNumber(paths: ConfigPath, envKeys: string | readonly string[], fallback: number): number;
  positiveInt(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number;
  nonNegativeInt(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number;
  numberOrUnlimited(paths: ConfigPath, envKeys: string | readonly string[], fallback: number): number | undefined;
  optionName(paths: ConfigPathInput, envKeys: string | readonly string[]): string;
}

export function envOptional(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

export function envRaw(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[key];
}

export function normalizePaths(paths: ConfigPathInput): ConfigPath[] {
  if (paths.length === 0) return [];
  return typeof paths[0] === "string" ? [paths as ConfigPath] : [...(paths as readonly ConfigPath[])];
}

export function normalizeKeys(keys: string | readonly string[]): string[] {
  return typeof keys === "string" ? [keys] : [...keys];
}

export function optionName(paths: ConfigPathInput, envKeys: string | readonly string[]): string {
  const envPart = normalizeKeys(envKeys).join(" / ");
  const pathPart = normalizePaths(paths).map((p) => p.join(".")).join(" / ");
  return `${envPart || "(no env)"} / ${pathPart}`;
}

export function parseNumberOrUnlimited(raw: unknown, name: string, scalarString: (raw: unknown, name: string) => string | undefined): number | undefined {
  if (typeof raw === "number") {
    if (raw === 0) return undefined;
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  }
  const s = scalarString(raw, name)?.toLowerCase();
  if (!s || s === "0" || s === "unlimited" || s === "none") return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createConfigReader(data: ConfigObject, env: NodeJS.ProcessEnv = process.env): ConfigReader {
  function getPath(path: ConfigPath): unknown {
    let current: unknown = data;
    for (const segment of path) {
      if (!isPlainObject(current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  function readRaw(paths: ConfigPathInput, envKeys: string | readonly string[], fallback?: unknown): unknown {
    for (const key of normalizeKeys(envKeys)) {
      const v = envOptional(key, env);
      if (v !== undefined) return v;
    }

    for (const path of normalizePaths(paths)) {
      const v = getPath(path);
      if (v !== undefined && v !== null) return v;
    }

    return fallback;
  }

  function scalarString(raw: unknown, name: string): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw) || isPlainObject(raw)) {
      throw new Error(`Invalid config ${name}: expected string`);
    }
    const v = String(raw).trim();
    return v ? v : undefined;
  }

  function requiredString(paths: ConfigPathInput, envKeys: string | readonly string[], fallback?: string): string {
    const name = optionName(paths, envKeys);
    const v = scalarString(readRaw(paths, envKeys, fallback), name);
    if (!v) throw new Error(`Missing config: ${name}`);
    return v;
  }

  function optionalString(paths: ConfigPathInput, envKeys: string | readonly string[]): string | undefined {
    return scalarString(readRaw(paths, envKeys), optionName(paths, envKeys));
  }

  function stringOrInherit(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: string): string | undefined {
    const name = optionName(paths, envKeys);
    const raw = scalarString(readRaw(paths, envKeys, fallback), name);
    if (!raw) return fallback;
    return raw.toLowerCase() === "inherit" ? undefined : raw;
  }

  function oneOf<T extends string>(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: T, allowed: readonly T[]): T {
    const name = optionName(paths, envKeys);
    const raw = scalarString(readRaw(paths, envKeys, fallback), name)?.toLowerCase() ?? fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    throw new Error(`Invalid config ${name}: ${raw}. Expected one of: ${allowed.join(", ")}`);
  }

  function oneOfOrInherit<T extends string>(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: T, allowed: readonly T[]): T | undefined {
    const name = optionName(paths, envKeys);
    const raw = scalarString(readRaw(paths, envKeys, fallback), name)?.toLowerCase() ?? fallback;
    if (raw === "inherit") return undefined;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    throw new Error(`Invalid config ${name}: ${raw}. Expected one of: inherit, ${allowed.join(", ")}`);
  }

  function boolValue(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: boolean): boolean {
    const raw = readRaw(paths, envKeys, fallback);
    if (typeof raw === "boolean") return raw;
    const name = optionName(paths, envKeys);
    const s = scalarString(raw, name)?.toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    throw new Error(`Invalid config ${name}: ${String(raw)}. Expected true or false`);
  }

  function boolOrInherit(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: boolean): boolean | undefined {
    const raw = readRaw(paths, envKeys, fallback);
    if (typeof raw === "boolean") return raw;
    const name = optionName(paths, envKeys);
    const s = scalarString(raw, name)?.toLowerCase();
    if (s === "inherit") return undefined;
    if (s === "true") return true;
    if (s === "false") return false;
    throw new Error(`Invalid config ${name}: ${String(raw)}. Expected one of: inherit, true, false`);
  }

  function stringArray(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: readonly string[] = []): string[] {
    const raw = readRaw(paths, envKeys, fallback);
    const name = optionName(paths, envKeys);
    if (Array.isArray(raw)) {
      return raw.map((v) => scalarString(v, name)).filter((v): v is string => Boolean(v));
    }

    const s = scalarString(raw, name);
    if (!s) return [];
    const lower = s.toLowerCase();
    if (lower === "none" || lower === "disabled" || lower === "false") return [];
    return s.split(",").map((v) => v.trim()).filter(Boolean);
  }

  function settingSources(paths: ConfigPath, envKeys: string | readonly string[], fallback: readonly string[]): ClaudeSettingSource[] {
    const values = stringArray(paths, envKeys, fallback).map((v) => v.toLowerCase());
    const seen = new Set<ClaudeSettingSource>();
    for (const value of values) {
      if (!(claudeSettingSourceValues as readonly string[]).includes(value)) {
        throw new Error(`Invalid config ${optionName(paths, envKeys)}: ${value}. Expected one of: ${claudeSettingSourceValues.join(", ")}, none`);
      }
      seen.add(value as ClaudeSettingSource);
    }
    return [...seen];
  }

  function positiveNumber(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number {
    const raw = readRaw(paths, envKeys, fallback);
    const name = optionName(paths, envKeys);
    const n = typeof raw === "number" ? raw : Number(scalarString(raw, name));
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid config ${name}: expected positive number`);
    return n;
  }

  function nonNegativeNumber(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number {
    const raw = readRaw(paths, envKeys, fallback);
    const name = optionName(paths, envKeys);
    const n = typeof raw === "number" ? raw : Number(scalarString(raw, name));
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid config ${name}: expected non-negative number`);
    return n;
  }

  function confidenceNumber(paths: ConfigPath, envKeys: string | readonly string[], fallback: number): number {
    const raw = readRaw(paths, envKeys, fallback);
    const name = optionName(paths, envKeys);
    const n = typeof raw === "number" ? raw : Number(scalarString(raw, name));
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(`Invalid config ${name}: expected number between 0 and 1`);
    }
    return n;
  }

  function positiveInt(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number {
    const n = positiveNumber(paths, envKeys, fallback);
    if (!Number.isInteger(n)) throw new Error(`Invalid config ${optionName(paths, envKeys)}: expected positive integer`);
    return n;
  }

  function nonNegativeInt(paths: ConfigPathInput, envKeys: string | readonly string[], fallback: number): number {
    const n = nonNegativeNumber(paths, envKeys, fallback);
    if (!Number.isInteger(n)) throw new Error(`Invalid config ${optionName(paths, envKeys)}: expected non-negative integer`);
    return n;
  }

  function numberOrUnlimited(paths: ConfigPath, envKeys: string | readonly string[], fallback: number): number | undefined {
    const name = optionName(paths, envKeys);

    for (const key of normalizeKeys(envKeys)) {
      const envValue = envRaw(key, env);
      if (envValue !== undefined) return parseNumberOrUnlimited(envValue, name, scalarString);
    }

    return parseNumberOrUnlimited(readRaw(paths, [], fallback), name, scalarString);
  }

  return {
    getPath,
    readRaw,
    scalarString,
    requiredString,
    optionalString,
    stringOrInherit,
    oneOf,
    oneOfOrInherit,
    boolValue,
    boolOrInherit,
    stringArray,
    settingSources,
    positiveNumber,
    nonNegativeNumber,
    confidenceNumber,
    positiveInt,
    nonNegativeInt,
    numberOrUnlimited,
    optionName,
  };
}

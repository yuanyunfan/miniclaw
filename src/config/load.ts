import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { envOptional } from "./env.js";
import { parseRawConfigObject } from "./schema.js";
import { resolveHome } from "./resolve.js";
import type { ConfigObject } from "./types.js";

export const DEFAULT_CONFIG_PATH = join(homedir(), ".miniclaw", "config.yaml");

export interface LoadedConfigSource {
  path: string;
  configuredPath?: string;
  explicitPath: boolean;
  loaded: boolean;
  data: ConfigObject;
}

export function isDefaultConfigReference(raw: string | undefined, defaultPath = DEFAULT_CONFIG_PATH): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  return trimmed === "~/.miniclaw/config.yaml" || trimmed === defaultPath;
}

export function loadYamlConfig(
  path: string,
  explicitPath: boolean,
  rawPath: string | undefined,
  defaultPath = DEFAULT_CONFIG_PATH
): { data: ConfigObject; loaded: boolean } {
  if (!existsSync(path)) {
    if (explicitPath && !isDefaultConfigReference(rawPath, defaultPath)) {
      throw new Error(`MINICLAW_CONFIG points to a missing file: ${path}`);
    }
    return { data: {}, loaded: false };
  }

  const raw = readFileSync(path, "utf8");
  const parsed = yaml.load(raw) ?? {};
  return { data: parseRawConfigObject(parsed, path), loaded: true };
}

export function loadRuntimeConfigSource(env: NodeJS.ProcessEnv = process.env): LoadedConfigSource {
  const configuredPath = envOptional("MINICLAW_CONFIG", env);
  const path = resolveHome(configuredPath ?? DEFAULT_CONFIG_PATH);
  const file = loadYamlConfig(path, configuredPath !== undefined, configuredPath);
  return {
    path,
    configuredPath,
    explicitPath: configuredPath !== undefined,
    loaded: file.loaded,
    data: file.data,
  };
}

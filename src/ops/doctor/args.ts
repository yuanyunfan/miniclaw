import { homedir } from "node:os";
import { resolve } from "node:path";
import type { DoctorArgs } from "./types.js";

export function resolveHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function readRequiredArg(argv: string[], index: number, flag: string, description: string): string {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires ${description}`);
  return value;
}

export function parseDoctorArgs(argv: string[]): DoctorArgs {
  const args: DoctorArgs = {
    mode: "recent",
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--recent") {
      args.mode = "recent";
      args.taskIdPrefix = undefined;
      args.cronJobName = undefined;
    } else if (arg === "--task") {
      const value = readRequiredArg(argv, i, "--task", "a task id prefix");
      i += 1;
      args.mode = "task";
      args.taskIdPrefix = value;
      args.cronJobName = undefined;
    } else if (arg === "--cron") {
      const value = readRequiredArg(argv, i, "--cron", "a cron job name");
      i += 1;
      args.mode = "cron";
      args.cronJobName = value;
      args.taskIdPrefix = undefined;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--db") {
      const value = readRequiredArg(argv, i, "--db", "a SQLite DB path");
      i += 1;
      args.dbPath = resolveHome(value);
    } else if (arg === "--cron-state") {
      const value = readRequiredArg(argv, i, "--cron-state", "a JSON state path");
      i += 1;
      args.cronStatePath = resolveHome(value);
    } else if (arg === "--connectivity-state") {
      const value = readRequiredArg(argv, i, "--connectivity-state", "a JSON state path");
      i += 1;
      args.connectivityStatePath = resolveHome(value);
    } else if (arg === "--log-dir") {
      const value = readRequiredArg(argv, i, "--log-dir", "a log directory");
      i += 1;
      args.logDir = resolveHome(value);
    } else if (arg === "--cwd") {
      const value = readRequiredArg(argv, i, "--cwd", "a working directory");
      i += 1;
      args.cwd = resolveHome(value);
    } else if (arg === "--app") {
      const value = readRequiredArg(argv, i, "--app", "a PM2 app name");
      i += 1;
      args.pm2App = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

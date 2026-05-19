import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ConnectivityStatus =
  | "discord_ok"
  | "discord_unreachable"
  | "general_network_down"
  | "smtp_unreachable"
  | "vpn_or_proxy_suspected"
  | "recovered";

export interface ProbeResult {
  ok: boolean;
  latency_ms?: number;
  error?: string;
  skipped?: boolean;
}

export interface ConnectivityChecks {
  discord_gateway: ProbeResult;
  discord_rest: ProbeResult;
  general_network: ProbeResult;
  smtp: ProbeResult;
}

export interface ConnectivitySnapshot {
  updated_at: string;
  status: ConnectivityStatus;
  consecutive_failures: number;
  outage_started_at?: string;
  last_outage_started_at?: string;
  last_alert_at?: string;
  last_recovery_alert_at?: string;
  last_alert_error?: string;
  checks: ConnectivityChecks;
}

export interface ConnectivityCheckers {
  discordGateway(): Promise<ProbeResult>;
  discordRest(): Promise<ProbeResult>;
  generalNetwork(): Promise<ProbeResult>;
  smtp(): Promise<ProbeResult>;
}

export interface ConnectivityAlertMessage {
  subject: string;
  text: string;
}

export interface ConnectivityTickOptions {
  statePath: string;
  failureThreshold: number;
  checkers: ConnectivityCheckers;
  sendAlert?: (message: ConnectivityAlertMessage) => Promise<void>;
  now?: () => Date;
}

function sanitizeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/(password|pass|token|secret|authorization|cookie|session)\s*[:=]\s*[^,\s}]+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{32,}\b/g, "[redacted]")
    .slice(0, 500);
}

function sanitizeProbe(probe: ProbeResult): ProbeResult {
  return {
    ok: probe.ok,
    ...(typeof probe.latency_ms === "number" ? { latency_ms: Math.round(probe.latency_ms) } : {}),
    ...(probe.error ? { error: sanitizeError(probe.error) } : {}),
    ...(probe.skipped ? { skipped: true } : {}),
  };
}

async function safeProbe(fn: () => Promise<ProbeResult>): Promise<ProbeResult> {
  try {
    return sanitizeProbe(await fn());
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}

function discordOk(checks: ConnectivityChecks): boolean {
  return checks.discord_gateway.ok && checks.discord_rest.ok;
}

export function classifyConnectivity(checks: ConnectivityChecks, previous?: ConnectivitySnapshot): ConnectivityStatus {
  if (!checks.general_network.ok) return "general_network_down";
  if (!discordOk(checks)) {
    if (checks.smtp.ok) return "vpn_or_proxy_suspected";
    return "discord_unreachable";
  }
  if (!checks.smtp.ok && !checks.smtp.skipped) return "smtp_unreachable";
  return previous?.outage_started_at ? "recovered" : "discord_ok";
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function probeLine(name: string, probe: ProbeResult): string {
  const status = probe.ok ? "ok" : probe.skipped ? "skipped" : "failed";
  const latency = typeof probe.latency_ms === "number" ? `, ${probe.latency_ms}ms` : "";
  const error = probe.error ? `, error=${probe.error}` : "";
  return `- ${name}: ${status}${latency}${error}`;
}

export function buildConnectivityOutageAlert(snapshot: ConnectivitySnapshot): ConnectivityAlertMessage {
  return {
    subject: "MiniClaw Discord 链路中断",
    text: [
      "MiniClaw Discord 链路中断",
      "",
      `时间: ${snapshot.updated_at}`,
      `状态: ${snapshot.status}`,
      `连续失败: ${snapshot.consecutive_failures}`,
      `可能原因: ${snapshot.status === "vpn_or_proxy_suspected" ? "VPN / proxy 断开或 Discord 出站链路异常" : "网络或 Discord 链路异常"}`,
      "已影响: cron/task 的 Discord 推送可能失败或延迟。",
      "建议: 检查 VPN、代理、pm2 日志和本机网络。",
      "",
      "检查结果:",
      probeLine("Discord gateway", snapshot.checks.discord_gateway),
      probeLine("Discord REST", snapshot.checks.discord_rest),
      probeLine("General network", snapshot.checks.general_network),
      probeLine("SMTP", snapshot.checks.smtp),
    ].join("\n"),
  };
}

export function buildConnectivityRecoveryAlert(previous: ConnectivitySnapshot, recoveredAt: string): ConnectivityAlertMessage {
  const startedAt = previous.outage_started_at ?? previous.updated_at;
  const durationMs = Date.parse(recoveredAt) - Date.parse(startedAt);
  return {
    subject: "MiniClaw Discord 链路已恢复",
    text: [
      "MiniClaw Discord 链路已恢复",
      "",
      `恢复时间: ${recoveredAt}`,
      `中断开始: ${startedAt}`,
      `中断时长: ${Number.isFinite(durationMs) ? formatDuration(durationMs) : "unknown"}`,
    ].join("\n"),
  };
}

export function loadConnectivityState(path: string): ConnectivitySnapshot | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ConnectivitySnapshot;
    if (!parsed || typeof parsed !== "object" || !parsed.status || !parsed.checks) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function persistConnectivityState(path: string, snapshot: ConnectivitySnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  renameSync(tmp, path);
}

export async function runConnectivityTick(options: ConnectivityTickOptions): Promise<ConnectivitySnapshot> {
  const now = options.now?.() ?? new Date();
  const previous = loadConnectivityState(options.statePath);
  const checks: ConnectivityChecks = {
    discord_gateway: await safeProbe(options.checkers.discordGateway),
    discord_rest: await safeProbe(options.checkers.discordRest),
    general_network: await safeProbe(options.checkers.generalNetwork),
    smtp: await safeProbe(options.checkers.smtp),
  };

  const status = classifyConnectivity(checks, previous);
  const failed = status !== "discord_ok" && status !== "recovered";
  const consecutiveFailures = failed ? (previous?.consecutive_failures ?? 0) + 1 : 0;
  const outageStartedAt = failed ? previous?.outage_started_at ?? now.toISOString() : undefined;

  let snapshot: ConnectivitySnapshot = {
    updated_at: now.toISOString(),
    status,
    consecutive_failures: consecutiveFailures,
    ...(outageStartedAt ? { outage_started_at: outageStartedAt } : {}),
    ...(previous?.last_outage_started_at ? { last_outage_started_at: previous.last_outage_started_at } : {}),
    ...(failed && previous?.last_alert_at ? { last_alert_at: previous.last_alert_at } : {}),
    ...(!failed && previous?.last_recovery_alert_at ? { last_recovery_alert_at: previous.last_recovery_alert_at } : {}),
    ...(failed && previous?.last_alert_error ? { last_alert_error: previous.last_alert_error } : {}),
    checks,
  };

  const discordFailed = !discordOk(checks);
  const canAlert = checks.general_network.ok && Boolean(options.sendAlert);
  if (failed && consecutiveFailures >= Math.max(1, options.failureThreshold) && !previous?.last_alert_at && discordFailed && canAlert) {
    try {
      await options.sendAlert?.(buildConnectivityOutageAlert(snapshot));
      const withoutAlertError = { ...snapshot };
      delete withoutAlertError.last_alert_error;
      snapshot = { ...withoutAlertError, last_alert_at: now.toISOString() };
    } catch (err) {
      snapshot = { ...snapshot, last_alert_error: sanitizeError(err) };
    }
  }

  if (status === "recovered" && previous?.last_alert_at && options.sendAlert) {
    try {
      await options.sendAlert(buildConnectivityRecoveryAlert(previous, now.toISOString()));
      snapshot = {
        ...snapshot,
        last_recovery_alert_at: now.toISOString(),
        last_outage_started_at: previous.outage_started_at ?? previous.updated_at,
      };
    } catch (err) {
      snapshot = { ...snapshot, last_alert_error: sanitizeError(err) };
    }
  }

  persistConnectivityState(options.statePath, snapshot);
  return snapshot;
}

export const __testables = { sanitizeError, discordOk, probeLine };

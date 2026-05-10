import { loadFutuStockConfig } from "../mcp/futu-stock/config.js";
import { PythonFutuStockClient } from "../mcp/futu-stock/futu-client.js";
import { mapFutuRawBrokerData } from "../mcp/futu-stock/mapper.js";
import type { FutuRawBrokerData, FutuStockClient, FutuStockConfig } from "../mcp/futu-stock/types.js";
import { HttpEastmoneyJywgClient } from "../mcp/eastmoney-jywg/client.js";
import { loadEastmoneyJywgConfig } from "../mcp/eastmoney-jywg/config.js";
import { mapEastmoneyJywgRawBrokerData } from "../mcp/eastmoney-jywg/mapper.js";
import {
  loadEastmoneyJywgSession,
  saveEastmoneyJywgSession,
} from "../mcp/eastmoney-jywg/session-vault.js";
import type {
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgRawBrokerData,
  EastmoneyJywgSession,
} from "../mcp/eastmoney-jywg/types.js";

export type ThirdPartyHealthProvider = "futu-stock" | "eastmoney-jywg";
export type ThirdPartyHealthStatus = "ok" | "error";
export type ThirdPartyHealthStage = "config" | "session" | "health" | "query";

export interface ThirdPartyHealthCheck {
  provider: ThirdPartyHealthProvider;
  profile: string;
  status: ThirdPartyHealthStatus;
  stage: ThirdPartyHealthStage;
  detail: string;
  checked_at: string;
  positions_count?: number;
  host?: string;
  port?: number;
  cookie_count?: number;
  last_verified_at?: string;
  captured_at?: string;
}

export interface ThirdPartyHealthReport {
  checked_at: string;
  ok: boolean;
  checks: ThirdPartyHealthCheck[];
}

export interface ThirdPartyHealthDeps {
  loadFutuConfig?: () => FutuStockConfig;
  futuClient?: FutuStockClient;
  loadEastmoneyConfig?: () => EastmoneyJywgConfig;
  eastmoneyClient?: EastmoneyJywgClient;
  loadEastmoneySession?: typeof loadEastmoneyJywgSession;
  saveEastmoneySession?: typeof saveEastmoneyJywgSession;
  now?: () => Date;
}

function redactSensitiveText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/(cookie|validate[_-]?key|token|password|secret|session|acc[_-]?id)\s*[:=]\s*[^,\s;]+/gi, "$1=<redacted>")
    .replace(/(Cookie:\s*)[^\n\r]+/gi, "$1<redacted>")
    .replace(/([?&]validatekey=)[^&\s]+/gi, "$1<redacted>")
    .slice(0, 500);
}

function okCheck(
  provider: ThirdPartyHealthProvider,
  profile: string,
  checkedAt: string,
  detail: string,
  extra: Partial<ThirdPartyHealthCheck> = {},
): ThirdPartyHealthCheck {
  return {
    provider,
    profile,
    status: "ok",
    stage: "query",
    detail,
    checked_at: checkedAt,
    ...extra,
  };
}

function errorCheck(
  provider: ThirdPartyHealthProvider,
  profile: string,
  checkedAt: string,
  stage: ThirdPartyHealthStage,
  detail: unknown,
  extra: Partial<ThirdPartyHealthCheck> = {},
): ThirdPartyHealthCheck {
  return {
    provider,
    profile,
    status: "error",
    stage,
    detail: redactSensitiveText(detail),
    checked_at: checkedAt,
    ...extra,
  };
}

async function checkFutuProfiles(
  checkedAt: string,
  deps: Required<Pick<ThirdPartyHealthDeps, "loadFutuConfig" | "futuClient">>,
): Promise<ThirdPartyHealthCheck[]> {
  let config: FutuStockConfig;
  try {
    config = deps.loadFutuConfig();
  } catch (err) {
    return [errorCheck("futu-stock", "config", checkedAt, "config", err)];
  }

  const checks: ThirdPartyHealthCheck[] = [];
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const common = {
      host: profile.opend_host,
      port: profile.opend_port,
    };
    try {
      const health = await deps.futuClient.healthCheck(profile);
      if (!health.ok) {
        const detail = health.opend.error ?? health.python.error ?? "Futu OpenD or Python SDK health check failed";
        checks.push(errorCheck("futu-stock", profileName, checkedAt, "health", detail, common));
        continue;
      }
    } catch (err) {
      checks.push(errorCheck("futu-stock", profileName, checkedAt, "health", err, common));
      continue;
    }

    try {
      const raw = await deps.futuClient.getRawBrokerData(profile);
      const snapshot = mapFutuRawBrokerData(raw as FutuRawBrokerData, profile, "third_party_health_check");
      checks.push(okCheck("futu-stock", profileName, checkedAt, "Futu OpenD and read-only broker query succeeded", {
        ...common,
        positions_count: snapshot.positions.length,
        captured_at: snapshot.captured_at,
      }));
    } catch (err) {
      checks.push(errorCheck("futu-stock", profileName, checkedAt, "query", err, common));
    }
  }
  return checks;
}

async function checkEastmoneyProfiles(
  checkedAt: string,
  deps: Required<Pick<
    ThirdPartyHealthDeps,
    "loadEastmoneyConfig" | "eastmoneyClient" | "loadEastmoneySession" | "saveEastmoneySession"
  >>,
): Promise<ThirdPartyHealthCheck[]> {
  let config: EastmoneyJywgConfig;
  try {
    config = deps.loadEastmoneyConfig();
  } catch (err) {
    return [errorCheck("eastmoney-jywg", "config", checkedAt, "config", err)];
  }

  const checks: ThirdPartyHealthCheck[] = [];
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    const common = {
      host: new URL(profile.base_url).hostname,
    };
    let session: EastmoneyJywgSession;
    try {
      session = deps.loadEastmoneySession(profile.session_secret_path);
    } catch (err) {
      checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "session", err, common));
      continue;
    }

    const sessionMeta = {
      ...common,
      cookie_count: session.cookies.length,
      last_verified_at: session.last_verified_at,
    };

    try {
      const health = await deps.eastmoneyClient.healthCheck(profile, session);
      if (!health.ok) {
        checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "health", health.session.error ?? "Eastmoney JYWG health check failed", sessionMeta));
        continue;
      }
    } catch (err) {
      checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "health", err, sessionMeta));
      continue;
    }

    try {
      const raw = await deps.eastmoneyClient.getRawBrokerData(profile, session, {
        includeOrders: false,
        includeDeals: false,
      });
      const snapshot = mapEastmoneyJywgRawBrokerData(raw as EastmoneyJywgRawBrokerData, profile, "third_party_health_check");
      deps.saveEastmoneySession(profile.session_secret_path, raw.updated_session);
      checks.push(okCheck("eastmoney-jywg", profileName, checkedAt, "Eastmoney JYWG session and read-only broker query succeeded", {
        ...sessionMeta,
        positions_count: snapshot.positions.length,
        captured_at: snapshot.captured_at,
      }));
    } catch (err) {
      checks.push(errorCheck("eastmoney-jywg", profileName, checkedAt, "query", err, sessionMeta));
    }
  }
  return checks;
}

export async function runThirdPartyHealthCheck(deps: ThirdPartyHealthDeps = {}): Promise<ThirdPartyHealthReport> {
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  const [futu, eastmoney] = await Promise.all([
    checkFutuProfiles(checkedAt, {
      loadFutuConfig: deps.loadFutuConfig ?? loadFutuStockConfig,
      futuClient: deps.futuClient ?? new PythonFutuStockClient(),
    }),
    checkEastmoneyProfiles(checkedAt, {
      loadEastmoneyConfig: deps.loadEastmoneyConfig ?? loadEastmoneyJywgConfig,
      eastmoneyClient: deps.eastmoneyClient ?? new HttpEastmoneyJywgClient(),
      loadEastmoneySession: deps.loadEastmoneySession ?? loadEastmoneyJywgSession,
      saveEastmoneySession: deps.saveEastmoneySession ?? saveEastmoneyJywgSession,
    }),
  ]);
  const checks = [...futu, ...eastmoney];
  return {
    checked_at: checkedAt,
    ok: checks.every((check) => check.status === "ok"),
    checks,
  };
}

function actionHint(check: ThirdPartyHealthCheck): string {
  if (check.provider === "eastmoney-jywg") {
    return "运行 `pnpm eastmoney-jywg:login` 重新完成可见浏览器登录/校验。";
  }
  if (check.provider === "futu-stock" && check.stage === "health") {
    return "确认 Futu OpenD/Moomoo OpenD 正在运行，且配置中的 Python 能 import `futu` 或 `moomoo`。";
  }
  return "查看 MiniClaw provider 配置和最近 cron 日志后重试。";
}

export function formatThirdPartyHealthIssueReport(report: ThirdPartyHealthReport): string {
  const issues = report.checks.filter((check) => check.status === "error");
  if (issues.length === 0) return "";

  const lines = [
    "⚠️ **MiniClaw 第三方连接健康检查**",
    "",
    `时间：${report.checked_at}`,
    `异常数：${issues.length}`,
    "",
  ];

  for (const issue of issues) {
    const target = `${issue.provider}/${issue.profile}`;
    lines.push(`- **${target}**：${issue.stage} 异常，${issue.detail}`);
    if (issue.last_verified_at) lines.push(`  - 上次验证：${issue.last_verified_at}`);
    if (issue.cookie_count !== undefined) lines.push(`  - cookie_count：${issue.cookie_count}`);
    lines.push(`  - 建议：${actionHint(issue)}`);
  }

  lines.push("");
  lines.push("正常连接不会发送通知；只有异常会出现在这个频道。");
  return lines.join("\n");
}

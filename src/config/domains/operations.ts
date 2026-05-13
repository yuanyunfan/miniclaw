import type { ConfigReader } from "../env.js";
import { resolveHome } from "../resolve.js";
import type { SmtpEmailNotificationConfig } from "../types.js";

const doctorAllowedPathsFallback = [
  "src/**/*.ts",
  "scripts/**/*.ts",
  "docs/**/*.md",
  "prompts/**/*.md",
  "config.example.yaml",
] as const;

const doctorBlockedPathsFallback = [
  ".env",
  ".env.*",
  ".npmrc",
  ".netrc",
  "~/.miniclaw/**",
  "~/.ssh/**",
  "**/*.db",
  "**/*.sqlite",
  "**/*.log",
] as const;

export function buildOperationalRuntimeConfig(reader: ConfigReader, e2eMode: boolean) {
  const notifyEmailHost = reader.optionalString([
    ["notifications", "email", "smtp_host"],
    ["email", "smtp_host"],
  ], "MINICLAW_NOTIFY_EMAIL_SMTP_HOST");
  const notifyEmailUsername = reader.optionalString([
    ["notifications", "email", "username"],
    ["email", "username"],
  ], "MINICLAW_NOTIFY_EMAIL_USERNAME");
  const notifyEmailPassword = reader.optionalString([
    ["notifications", "email", "password"],
    ["email", "password"],
  ], "MINICLAW_NOTIFY_EMAIL_PASSWORD");
  const notifyEmailTo = reader.optionalString([
    ["notifications", "email", "to"],
    ["email", "to"],
  ], "MINICLAW_NOTIFY_EMAIL_TO");
  const notifyEmailEnabledByConfig = Boolean(
    notifyEmailHost && notifyEmailUsername && notifyEmailPassword && notifyEmailTo
  );

  return {
    connectivity: {
      enabled: reader.boolValue(["connectivity", "enabled"], "MINICLAW_CONNECTIVITY_MONITOR_ENABLED", !e2eMode),
      intervalMs: reader.positiveNumber(["connectivity", "interval_ms"], "MINICLAW_CONNECTIVITY_INTERVAL_MS", 60_000),
      failureThreshold: reader.positiveInt(
        ["connectivity", "failure_threshold"],
        "MINICLAW_CONNECTIVITY_FAILURE_THRESHOLD",
        3
      ),
      requestTimeoutMs: reader.positiveNumber(
        ["connectivity", "request_timeout_ms"],
        "MINICLAW_CONNECTIVITY_REQUEST_TIMEOUT_MS",
        10_000
      ),
      generalTestUrl: reader.requiredString(
        ["connectivity", "general_test_url"],
        "MINICLAW_CONNECTIVITY_GENERAL_TEST_URL",
        "https://www.qq.com"
      ),
      statePath: resolveHome(reader.requiredString(
        ["connectivity", "state_path"],
        "MINICLAW_CONNECTIVITY_STATE_PATH",
        "~/.miniclaw/runtime/connectivity.json"
      )),
    },
    startupWatchdog: {
      enabled: reader.boolValue(["startup_watchdog", "enabled"], "MINICLAW_STARTUP_WATCHDOG_ENABLED", !e2eMode),
      clientReadyTimeoutMs: reader.positiveNumber(
        ["startup_watchdog", "client_ready_timeout_ms"],
        "MINICLAW_STARTUP_WATCHDOG_CLIENT_READY_TIMEOUT_MS",
        60_000
      ),
      macosNotificationEnabled: reader.boolValue(
        ["startup_watchdog", "macos_notification_enabled"],
        "MINICLAW_STARTUP_WATCHDOG_MACOS_NOTIFICATION_ENABLED",
        true
      ),
    },
    doctor: {
      enabled: reader.boolValue(["doctor", "enabled"], "MINICLAW_DOCTOR_ENABLED", true),
      autoDiagnoseEnabled: reader.boolValue(
        ["doctor", "auto_diagnose_enabled"],
        "MINICLAW_DOCTOR_AUTO_DIAGNOSE_ENABLED",
        false
      ),
      scanIntervalMs: reader.positiveNumber(
        ["doctor", "scan_interval_ms"],
        "MINICLAW_DOCTOR_SCAN_INTERVAL_MS",
        7_200_000
      ),
      summaryChannelId: reader.optionalString(
        ["doctor", "summary_channel_id"],
        "MINICLAW_DOCTOR_SUMMARY_CHANNEL_ID"
      ),
      summaryChannelName: reader.optionalString(
        ["doctor", "summary_channel_name"],
        "MINICLAW_DOCTOR_SUMMARY_CHANNEL_NAME"
      ) ?? "miniclaw-auto-improve",
      autoRepairEnabled: reader.boolValue(
        ["doctor", "auto_repair_enabled"],
        "MINICLAW_DOCTOR_AUTO_REPAIR_ENABLED",
        false
      ),
      autoCommitEnabled: reader.boolValue(
        ["doctor", "auto_commit_enabled"],
        "MINICLAW_DOCTOR_AUTO_COMMIT_ENABLED",
        true
      ),
      autoPushEnabled: reader.boolValue(
        ["doctor", "auto_push_enabled"],
        "MINICLAW_DOCTOR_AUTO_PUSH_ENABLED",
        false
      ),
      autoRestartEnabled: reader.boolValue(
        ["doctor", "auto_restart_enabled"],
        "MINICLAW_DOCTOR_AUTO_RESTART_ENABLED",
        false
      ),
      maxRepairsPerDay: reader.positiveInt(
        ["doctor", "max_repairs_per_day"],
        "MINICLAW_DOCTOR_MAX_REPAIRS_PER_DAY",
        2
      ),
      maxParallelRepairs: reader.positiveInt(
        ["doctor", "max_parallel_repairs"],
        "MINICLAW_DOCTOR_MAX_PARALLEL_REPAIRS",
        1
      ),
      maxPatchFiles: reader.positiveInt(["doctor", "max_patch_files"], "MINICLAW_DOCTOR_MAX_PATCH_FILES", 8),
      repairWorktreeRoot: resolveHome(reader.requiredString(
        ["doctor", "repair_worktree_root"],
        "MINICLAW_DOCTOR_REPAIR_WORKTREE_ROOT",
        "~/ProjectRepo/miniclaw-repairs"
      )),
      repairCommitAuthorName: reader.requiredString(
        ["doctor", "repair_commit_author_name"],
        "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_NAME",
        "yuanyunfan"
      ),
      repairCommitAuthorEmail: reader.requiredString(
        ["doctor", "repair_commit_author_email"],
        "MINICLAW_DOCTOR_REPAIR_COMMIT_AUTHOR_EMAIL",
        "59247355+yuanyunfan@users.noreply.github.com"
      ),
      requireApprovalForMain: reader.boolValue(
        ["doctor", "require_approval_for_main"],
        "MINICLAW_DOCTOR_REQUIRE_APPROVAL_FOR_MAIN",
        true
      ),
      allowedPaths: reader.stringArray(
        ["doctor", "allowed_paths"],
        "MINICLAW_DOCTOR_ALLOWED_PATHS",
        doctorAllowedPathsFallback
      ),
      blockedPaths: reader.stringArray(
        ["doctor", "blocked_paths"],
        "MINICLAW_DOCTOR_BLOCKED_PATHS",
        doctorBlockedPathsFallback
      ),
    },
    notifications: {
      email: {
        enabled: reader.boolValue([
          ["notifications", "email", "enabled"],
          ["email", "enabled"],
        ], "MINICLAW_NOTIFY_EMAIL_ENABLED", notifyEmailEnabledByConfig),
        smtpHost: notifyEmailHost,
        smtpPort: reader.positiveInt([
          ["notifications", "email", "smtp_port"],
          ["email", "smtp_port"],
        ], "MINICLAW_NOTIFY_EMAIL_SMTP_PORT", 465),
        useSsl: reader.boolValue([
          ["notifications", "email", "use_ssl"],
          ["email", "use_ssl"],
        ], "MINICLAW_NOTIFY_EMAIL_USE_SSL", true),
        username: notifyEmailUsername,
        password: notifyEmailPassword,
        from: reader.optionalString([
          ["notifications", "email", "from"],
          ["email", "from"],
        ], "MINICLAW_NOTIFY_EMAIL_FROM"),
        to: notifyEmailTo,
      } satisfies SmtpEmailNotificationConfig,
    },
  } as const;
}

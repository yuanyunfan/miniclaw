import type { ConfigReader } from "../env.js";
import { resolveHome } from "../resolve.js";

export function buildHookdRuntimeConfig(reader: ConfigReader) {
  return {
    hookd: {
      enabled: reader.boolValue(["hookd", "enabled"], "MINICLAW_HOOKD_ENABLED", false),
      socketPath: resolveHome(reader.requiredString(
        ["hookd", "socket_path"],
        "MINICLAW_HOOKD_SOCKET",
        "~/.miniclaw/runtime/hookd.sock"
      )),
      maxPayloadBytes: reader.positiveInt(
        ["hookd", "max_payload_bytes"],
        "MINICLAW_HOOKD_MAX_PAYLOAD_BYTES",
        256 * 1024
      ),
      zombieScanIntervalMs: reader.positiveInt(
        ["hookd", "zombie_scan_interval_ms"],
        "MINICLAW_HOOKD_ZOMBIE_SCAN_INTERVAL_MS",
        30_000
      ),
      approvalTimeoutMs: reader.positiveInt(
        ["hookd", "approval_timeout_ms"],
        "MINICLAW_HOOKD_APPROVAL_TIMEOUT_MS",
        10 * 60_000
      ),
      staleActiveMs: reader.positiveInt(
        ["hookd", "stale_active_ms"],
        "MINICLAW_HOOKD_STALE_ACTIVE_MS",
        15 * 60_000
      ),
      dashboardLimit: reader.positiveInt(
        ["hookd", "dashboard_limit"],
        "MINICLAW_HOOKD_DASHBOARD_LIMIT",
        8
      ),
    },
  } as const;
}

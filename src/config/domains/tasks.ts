import type { ConfigReader } from "../env.js";

export function buildTaskRuntimeConfig(reader: ConfigReader) {
  return {
    traceAutoAttach: {
      enabled: reader.boolValue(
        ["tasks", "trace_auto_attach", "enabled"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_ENABLED",
        false
      ),
      onFailure: reader.boolValue(
        ["tasks", "trace_auto_attach", "on_failure"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_ON_FAILURE",
        true
      ),
      minDurationMs: reader.nonNegativeNumber(
        ["tasks", "trace_auto_attach", "min_duration_ms"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_DURATION_MS",
        0
      ),
      minEventCount: reader.nonNegativeInt(
        ["tasks", "trace_auto_attach", "min_event_count"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_MIN_EVENT_COUNT",
        0
      ),
      maxBytes: reader.positiveInt(
        ["tasks", "trace_auto_attach", "max_bytes"],
        "MINICLAW_TASK_TRACE_AUTO_ATTACH_MAX_BYTES",
        120_000
      ),
    },
  } as const;
}

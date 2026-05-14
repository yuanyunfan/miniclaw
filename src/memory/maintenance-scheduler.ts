import { createLogger } from "../lib/log.js";
import {
  formatMemoryMaintenanceReport,
  runMemoryMaintenance,
  type MemoryMaintenanceReport,
} from "./maintenance.js";

const log = createLogger("memory-maintenance");

export interface MemoryMaintenanceSchedulerOptions {
  enabled: boolean;
  intervalMs: number;
  apply: boolean;
  runOnStart: boolean;
}

export interface MemoryMaintenanceSchedulerHandle {
  runNow: () => MemoryMaintenanceReport | undefined;
  stop: () => void;
}

function runOnce(options: Pick<MemoryMaintenanceSchedulerOptions, "apply">): MemoryMaintenanceReport | undefined {
  try {
    const report = runMemoryMaintenance({ dryRun: !options.apply });
    if (report.findings.length || report.applied.length) {
      log.info(formatMemoryMaintenanceReport(report).trim());
    } else {
      log.info(`Memory maintenance ${report.dry_run ? "dry-run" : "apply"} completed: no findings`);
    }
    return report;
  } catch (err) {
    log.error("Memory maintenance failed:", err);
    return undefined;
  }
}

export function startMemoryMaintenanceScheduler(
  options: MemoryMaintenanceSchedulerOptions,
): MemoryMaintenanceSchedulerHandle | null {
  if (!options.enabled) {
    log.info("Memory maintenance scheduler disabled");
    return null;
  }

  const timer = setInterval(() => {
    runOnce(options);
  }, options.intervalMs);
  timer.unref?.();

  log.info(
    `Memory maintenance scheduler started: interval=${options.intervalMs}ms mode=${options.apply ? "apply" : "dry-run"}`
  );

  if (options.runOnStart) {
    setImmediate(() => {
      runOnce(options);
    }).unref?.();
  }

  return {
    runNow: () => runOnce(options),
    stop: () => {
      clearInterval(timer);
      log.info("Memory maintenance scheduler stopped");
    },
  };
}

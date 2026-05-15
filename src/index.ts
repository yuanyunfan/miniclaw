import "./proxy.js";
import { config } from "./config.js";
import { initDb } from "./store/db.js";
import { registerCommands } from "./commands/register.js";
import { createBot } from "./bot.js";
import { startScheduler, stopScheduler } from "./cron/scheduler.js";
import { startConnectivityMonitor, type ConnectivityMonitorHandle } from "./monitoring/connectivity-monitor.js";
import {
  startMemoryMaintenanceScheduler,
  type MemoryMaintenanceSchedulerHandle,
} from "./memory/maintenance-scheduler.js";
import {
  startAgentRunManagerSweeper,
  type AgentRunManagerSweeperHandle,
} from "./agent/run-manager/sweeper.js";
import { startPreClientReadyWatchdog, type PreClientReadyWatchdogHandle } from "./monitoring/pre-client-ready-watchdog.js";
import { startDoctorScheduler, type DoctorSchedulerHandle } from "./ops/doctor-scheduler.js";
import { createLogger } from "./lib/log.js";
import {
  beginDraining,
  SHUTDOWN_DRAIN_TIMEOUT_SUMMARY,
  SHUTDOWN_FORCE_SUMMARY,
} from "./runtime/shutdown.js";
import {
  getActiveTaskCount,
  interruptActiveTasks,
  listActiveTaskIds,
  waitForActiveTasksToDrain,
} from "./agent/task.js";
import {
  getActiveChatCount,
  interruptActiveChats,
  listActiveChatIds,
  waitForActiveChatsToDrain,
} from "./agent/chat-runtime.js";

const log = createLogger("main");
let bot: ReturnType<typeof createBot> | null = null;
let connectivityMonitor: ConnectivityMonitorHandle | null = null;
let memoryMaintenanceScheduler: MemoryMaintenanceSchedulerHandle | null = null;
let agentRunManagerSweeper: AgentRunManagerSweeperHandle | null = null;
let startupWatchdog: PreClientReadyWatchdogHandle | null = null;
let doctorScheduler: DoctorSchedulerHandle | null = null;
let shutdownPromise: Promise<void> | null = null;
let signalCount = 0;

async function beginGracefulShutdown(reason: string, force = false): Promise<void> {
  signalCount++;

  if (force || signalCount >= 3) {
    const ids = interruptActiveTasks(SHUTDOWN_FORCE_SUMMARY);
    const chatIds = interruptActiveChats(SHUTDOWN_FORCE_SUMMARY);
    log.error(
      `Forcing shutdown after ${signalCount} signal(s); ` +
      `interrupted_tasks=${ids.join(",") || "none"} interrupted_chats=${chatIds.join(",") || "none"}`
    );
    connectivityMonitor?.stop();
    memoryMaintenanceScheduler?.stop();
    agentRunManagerSweeper?.stop();
    startupWatchdog?.stop();
    doctorScheduler?.stop();
    stopScheduler();
    await bot?.destroy();
    process.exit(1);
  }

  if (shutdownPromise) {
    log.warn(`Shutdown already draining after ${signalCount} signal(s); send one more signal to force exit`);
    return;
  }

  shutdownPromise = (async () => {
    beginDraining(reason);
    log.info("Shutting down: stopping connectivity monitor and cron scheduler");
    connectivityMonitor?.stop();
    memoryMaintenanceScheduler?.stop();
    agentRunManagerSweeper?.stop();
    startupWatchdog?.stop();
    doctorScheduler?.stop();
    stopScheduler();

    const activeAtStart = listActiveTaskIds();
    const activeChatsAtStart = listActiveChatIds();
    if (activeAtStart.length || activeChatsAtStart.length) {
      log.info(
        `Waiting for ${activeAtStart.length} active task(s) and ${activeChatsAtStart.length} active chat(s) to drain ` +
        `for up to ${config.shutdownDrainTimeoutMs}ms: ` +
        `tasks=${activeAtStart.join(",") || "none"} chats=${activeChatsAtStart.join(",") || "none"}`
      );
    }

    const [tasksDrained, chatsDrained] = await Promise.all([
      waitForActiveTasksToDrain(config.shutdownDrainTimeoutMs),
      waitForActiveChatsToDrain(config.shutdownDrainTimeoutMs),
    ]);
    if (!tasksDrained && getActiveTaskCount() > 0) {
      const interrupted = interruptActiveTasks(SHUTDOWN_DRAIN_TIMEOUT_SUMMARY);
      log.warn(`Drain timeout reached; interrupted task(s): ${interrupted.join(",") || "none"}`);
    }
    if (!chatsDrained && getActiveChatCount() > 0) {
      const interrupted = interruptActiveChats(SHUTDOWN_DRAIN_TIMEOUT_SUMMARY);
      log.warn(`Drain timeout reached; interrupted chat(s): ${interrupted.join(",") || "none"}`);
    }

    await bot?.destroy();
    log.info("Shutdown complete");
    process.exit(0);
  })().catch(async (err) => {
    log.error("Graceful shutdown failed:", err);
    interruptActiveTasks(SHUTDOWN_FORCE_SUMMARY);
    interruptActiveChats(SHUTDOWN_FORCE_SUMMARY);
    connectivityMonitor?.stop();
    memoryMaintenanceScheduler?.stop();
    agentRunManagerSweeper?.stop();
    startupWatchdog?.stop();
    doctorScheduler?.stop();
    stopScheduler();
    await bot?.destroy();
    process.exit(1);
  });

  await shutdownPromise;
}

async function main(): Promise<void> {
  log.info("Starting...");
  const budget = config.defaultBudgetUsd === undefined ? "unlimited" : `$${config.defaultBudgetUsd}`;
  const turns = config.defaultMaxTurns === undefined ? "unlimited" : String(config.defaultMaxTurns);
  log.info(
    `config: provider=${config.agentProvider} model=${config.model} ` +
    `budget=${budget} maxTurns=${turns} maxConcurrent=${config.maxConcurrentTasks}`
  );

  initDb();
  log.info("Database initialized");

  memoryMaintenanceScheduler = startMemoryMaintenanceScheduler(config.memoryMaintenance);
  agentRunManagerSweeper = startAgentRunManagerSweeper({
    enabled: config.agentRunManager.enabled,
    policy: config.agentRunManager.policy,
  });

  if (config.registerCommandsOnStart) {
    await registerCommands();
  } else {
    log.info("Slash command registration skipped (run `pnpm register` after command changes)");
  }

  bot = createBot();
  startupWatchdog = startPreClientReadyWatchdog({
    enabled: config.startupWatchdog.enabled,
    timeoutMs: config.startupWatchdog.clientReadyTimeoutMs,
    macosNotificationEnabled: config.startupWatchdog.macosNotificationEnabled,
  });
  bot.once("clientReady", (client) => {
    startupWatchdog?.markClientReady();
    connectivityMonitor = startConnectivityMonitor(client);
    doctorScheduler = startDoctorScheduler(client);
    if (config.e2e.disableScheduler) {
      log.info("Cron scheduler disabled by MINICLAW_DISABLE_SCHEDULER");
      return;
    }
    startScheduler(client);
  });
  try {
    await bot.login(config.discord.token);
  } catch (err) {
    await startupWatchdog?.notifyFailure("bot.login failed before Discord clientReady", err);
    throw err;
  }

  const shutdown = (signal: NodeJS.Signals) => {
    void beginGracefulShutdown(signal);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (err) => {
  log.error("Fatal error:", err);
  await startupWatchdog?.notifyFailure("MiniClaw fatal error before Discord clientReady", err);
  connectivityMonitor?.stop();
  memoryMaintenanceScheduler?.stop();
  agentRunManagerSweeper?.stop();
  startupWatchdog?.stop();
  doctorScheduler?.stop();
  void bot?.destroy();
  process.exit(1);
});

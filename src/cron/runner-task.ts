import { v4 as uuid } from "uuid";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { AttachmentBuilder, type Client, type SendableChannels } from "discord.js";
import { config } from "../config.js";
import { sendTextFanout } from "../im/delivery.js";
import { createTask } from "../store/db.js";
import { recordMarketContextFromReport, stripMarketContextJsonForDisplay } from "../store/market-context.js";
import { recordMarketForecastFromPayload, stripMarketForecastJsonForDisplay, updateMarketForecastReport } from "../store/market-forecasts.js";
import { executeTask, getActiveTaskCount, type TaskResult } from "../agent/task.js";
import { TaskReporter } from "../agent/task-reporter.js";
import { loadPrompt } from "../agent/prompts.js";
import type { CronJobRunContext, CronJobRunOutcome, CronJobTask, CronJobSkill } from "./types.js";
import { renderTemplate } from "./template.js";
import { resolve, join } from "node:path";
import { createLogger } from "../lib/log.js";
import { runPreProvider, runProviderDryRun, runProviderHealthCheck } from "../providers/index.js";
import type { PreProviderAttachment } from "../providers/types.js";
import { categorizeProviderError, type ProviderDryRunResult, type ProviderHealthResult } from "../providers/framework.js";
import type { MarketContextProviderPayload } from "../stock/data/market-context-types.js";
import type { MarketIntelPayload } from "../stock/data/market-intel-types.js";
import { DRAINING_MESSAGE, isDraining } from "../runtime/shutdown.js";
import { DailyMessageGroupReporter } from "./daily-message-group-reporter.js";
import {
  buildCronOutputContractBlock,
  resolveCronOutputContract,
  validateCronTaskOutput,
} from "./output-contract.js";

const log = createLogger("cron");
import { homedir } from "node:os";

interface CronTaskRunErrorMetadata {
  taskId?: string;
  providerName?: string;
  providerStatus?: string;
  providerCategory?: string;
  errorCategory?: string;
}

class CronTaskRunError extends Error {
  taskId?: string;
  providerName?: string;
  providerStatus?: string;
  providerCategory?: string;
  errorCategory?: string;

  constructor(message: string, metadata: CronTaskRunErrorMetadata = {}) {
    super(message);
    this.name = "CronTaskRunError";
    this.taskId = metadata.taskId;
    this.providerName = metadata.providerName;
    this.providerStatus = metadata.providerStatus;
    this.providerCategory = metadata.providerCategory;
    this.errorCategory = metadata.errorCategory;
  }
}

function abortReason(signal?: AbortSignal): string {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return "cron task run aborted";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new CronTaskRunError(abortReason(signal));
}

function attachCronTaskRunMetadata(err: unknown, metadata: CronTaskRunErrorMetadata): Error {
  if (err instanceof CronTaskRunError) {
    err.taskId = err.taskId ?? metadata.taskId;
    err.providerName = err.providerName ?? metadata.providerName;
    err.providerStatus = err.providerStatus ?? metadata.providerStatus;
    err.providerCategory = err.providerCategory ?? metadata.providerCategory;
    err.errorCategory = err.errorCategory ?? metadata.errorCategory;
    return err;
  }
  if (err instanceof Error) {
    Object.assign(err, metadata);
    return err;
  }
  return new CronTaskRunError(String(err), metadata);
}

function assertTaskResultOk(jobName: string, result: TaskResult, metadata: CronTaskRunErrorMetadata = {}): void {
  if (result.success) return;
  const summary = result.result.trim() || "task returned failure without details";
  throw new CronTaskRunError(`${jobName} task failed: ${summary.slice(0, 1500)}`, metadata);
}

function resolveHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

const SCRIPTS_DIR = process.env.MINICLAW_SCRIPTS_DIR ?? join(homedir(), ".miniclaw/scripts");
const PRE_SCRIPT_CONTEXT_MAX_CHARS = 50000;
const PRE_PROVIDER_CONTEXT_MAX_CHARS = 50000;

function cronRunAt(): Date {
  const override = process.env.MINICLAW_CRON_TEST_RUN_AT;
  if (!override) return new Date();
  const parsed = new Date(override);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`invalid MINICLAW_CRON_TEST_RUN_AT: ${override}`);
  }
  return parsed;
}

function buildCronPreScriptBlock(scriptName: string, stdout: string): string {
  const truncated = stdout.slice(0, PRE_SCRIPT_CONTEXT_MAX_CHARS)
    + (stdout.length > PRE_SCRIPT_CONTEXT_MAX_CHARS ? "\n... (truncated)" : "");
  return loadPrompt("templates/cron-pre-script-block", { script_name: scriptName, output: truncated }) + "\n\n";
}

function buildCronPreProviderBlock(providerName: string, output: string): string {
  const truncated = output.slice(0, PRE_PROVIDER_CONTEXT_MAX_CHARS)
    + (output.length > PRE_PROVIDER_CONTEXT_MAX_CHARS ? "\n... (truncated)" : "");
  return loadPrompt("templates/cron-pre-provider-block", { provider_name: providerName, output: truncated }) + "\n\n";
}

function buildCronTaskPrompt(
  jobName: string,
  prependedContext: string,
  renderedPrompt: string,
  outputContract = "",
): string {
  return loadPrompt("templates/cron-task-prompt", {
    job_name: jobName,
    prepended_context: prependedContext,
    output_contract: outputContract,
    user_prompt: renderedPrompt,
  });
}

function preflightModeLabel(mode: NonNullable<CronJobTask["pre_provider_preflight"]>): string {
  return mode === "dry_run" ? "dry-run" : mode;
}

function preflightProviderStatus(mode: NonNullable<CronJobTask["pre_provider_preflight"]>): string {
  return `${mode}_failed`;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw ? raw : undefined;
}

function preflightFailureMetadata(
  job: CronJobTask,
  mode: NonNullable<CronJobTask["pre_provider_preflight"]>,
  category?: string,
): CronTaskRunErrorMetadata {
  return {
    providerName: job.pre_provider,
    providerStatus: preflightProviderStatus(mode),
    providerCategory: category,
    errorCategory: category ?? "provider_preflight_failed",
  };
}

function healthFailureMessage(result: ProviderHealthResult): string {
  const category = result.category ? `${result.category}: ` : "";
  return `${category}${result.message}`;
}

function dryRunFailureMessage(result: ProviderDryRunResult): string {
  const category = result.category ? `${result.category}: ` : "";
  const message = result.previewText
    ?? (result.warnings.length ? result.warnings.join("; ") : "provider dry-run returned ok=false");
  return `${category}${message}`;
}

function parseMarketIntelPayload(providerText: string): MarketIntelPayload {
  const parsed = JSON.parse(providerText) as Partial<MarketIntelPayload>;
  if (
    parsed?.source !== "market-intel" ||
    typeof parsed.generated_at !== "string" ||
    typeof parsed.market_scope !== "string" ||
    typeof parsed.session !== "string" ||
    !parsed.run_context ||
    !parsed.scores
  ) {
    throw new Error("market-intel provider did not return a valid MarketIntelPayload JSON object");
  }
  return parsed as MarketIntelPayload;
}

function parseMarketContextProviderPayload(providerText: string): MarketContextProviderPayload {
  const parsed = JSON.parse(providerText) as Partial<MarketContextProviderPayload>;
  if (
    parsed?.source !== "market-context" ||
    typeof parsed.generated_at !== "string" ||
    typeof parsed.profile !== "string" ||
    typeof parsed.mode !== "string" ||
    !parsed.run_context
  ) {
    throw new Error("market-context provider did not return a valid MarketContextProviderPayload JSON object");
  }
  return parsed as MarketContextProviderPayload;
}

function stripMachineJsonForDisplay(reportText: string): string {
  return stripMarketContextJsonForDisplay(stripMarketForecastJsonForDisplay(reportText));
}

function buildCronSkillPrompt(jobName: string, skillName: string, skillArgs?: Record<string, string | number | boolean>): string {
  const argsStr = skillArgs
    ? "\n参数:\n" + Object.entries(skillArgs).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";
  return loadPrompt("templates/cron-skill-prompt", {
    job_name: jobName,
    skill_name: skillName,
    args_block: argsStr,
  });
}

export const __testables = { buildCronPreScriptBlock, buildCronPreProviderBlock, buildCronTaskPrompt, buildCronSkillPrompt };

function assertNotDraining(jobName: string): void {
  if (!isDraining()) return;
  const msg = `${jobName} skipped: ${DRAINING_MESSAGE}`;
  log.warn(msg);
  throw new CronTaskRunError(msg);
}

async function runPreScript(
  scriptName: string,
  args: string[],
  timeoutSec: number,
  jobName: string,
  channelId: string,
  runAt: Date,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  if (!existsSync(scriptPath)) throw new Error(`pre_script not found: ${scriptPath}`);
  const stat = statSync(scriptPath);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new Error(`pre_script not executable: ${scriptPath} (chmod +x)`);
  }

  const env = {
    ...process.env,
    MINICLAW_CRON_NAME: jobName,
    MINICLAW_CRON_RUN_AT: runAt.toISOString(),
    MINICLAW_CHANNEL_ID: channelId,
  };

  return await new Promise<string>((resolveOk, rejectErr) => {
    const child = spawn(scriptPath, args, { cwd: SCRIPTS_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    let abortedReason: string | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const abortRun = () => {
      if (killed) return;
      killed = true;
      abortedReason = abortReason(signal);
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    if (signal?.aborted) abortRun();
    else signal?.addEventListener("abort", abortRun, { once: true });
    const timer = setTimeout(() => {
      if (killed) return;
      killed = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutSec * 1000);

    child.stdout?.on("data", (c) => { stdout += c.toString(); });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abortRun);
      rejectErr(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abortRun);
      if (killed) rejectErr(new Error(abortedReason ?? `pre_script timeout (${timeoutSec}s)`));
      else if (code !== 0) rejectErr(new Error(`pre_script exit=${code}: ${stderr.slice(0, 500)}`));
      else resolveOk(stdout);
    });
  });
}

async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannels> {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !("isSendable" in ch) || !ch.isSendable()) {
    throw new Error(`channel ${channelId} not sendable or not found`);
  }
  return ch as SendableChannels;
}

async function sendPreProviderAttachments(
  channel: SendableChannels,
  jobName: string,
  attachments: PreProviderAttachment[],
): Promise<void> {
  if (!attachments.length) return;
  const existing = attachments.filter((attachment) => existsSync(attachment.path)).slice(0, 10);
  if (!existing.length) {
    log.warn(`${jobName} pre_provider produced attachment paths, but no files exist`);
    return;
  }
  try {
    await channel.send({
      content: `📊 cron \`${jobName}\` 附图`,
      files: existing.map((attachment) => new AttachmentBuilder(attachment.path, {
        name: attachment.name,
        description: attachment.description,
      })),
    });
  } catch (err) {
    log.warn(`${jobName} failed to send pre_provider attachment(s):`, err);
  }
}

async function sendExtraCronResultDelivery(
  client: Client,
  job: CronJobTask | CronJobSkill,
  text: string,
): Promise<void> {
  if (!job.delivery_route) return;
  const results = await sendTextFanout({
    client,
    fallbackDiscordTarget: job.channel,
    route: job.delivery_route,
    content: text,
    extraOnly: true,
    failOnError: false,
    metadata: { cron_name: job.name, cron_type: job.type },
  });
  for (const result of results) {
    if (result.error) {
      log.warn(`${job.name} extra IM delivery to ${result.target.transport}:${result.target.target} failed:`, result.error);
    }
  }
}

async function runPreProviderPreflight(job: CronJobTask, runAt: Date, signal?: AbortSignal): Promise<void> {
  if (!job.pre_provider || !job.pre_provider_preflight || job.pre_provider_preflight === "off") return;
  throwIfAborted(signal);
  const mode = job.pre_provider_preflight;
  const args = {
    configName: job.pre_provider_config,
    jobName: job.name,
    channelId: job.channel,
    runAt,
  };
  if (mode === "health") {
    const result = await runProviderHealthCheck(job.pre_provider, args);
    if (!result.ok) {
      throw new CronTaskRunError(healthFailureMessage(result), preflightFailureMetadata(job, mode, result.category));
    }
    throwIfAborted(signal);
    log.info(`${job.name} pre_provider ${job.pre_provider} health preflight ok`);
    return;
  }

  const result = await runProviderDryRun(job.pre_provider, args);
  if (!result.ok) {
    throw new CronTaskRunError(dryRunFailureMessage(result), preflightFailureMetadata(job, mode, result.category));
  }
  throwIfAborted(signal);
  log.info(`${job.name} pre_provider ${job.pre_provider} dry-run preflight ok`);
}

async function runPreContextProviders(
  job: CronJobTask,
  channel: SendableChannels,
  runAt: Date,
  signal?: AbortSignal,
): Promise<{ prependedContext: string; commits: Array<() => Promise<void>> }> {
  if (!job.pre_context_providers?.length) return { prependedContext: "", commits: [] };
  let prependedContext = "";
  const commits: Array<() => Promise<void>> = [];

  for (const contextProvider of job.pre_context_providers) {
    try {
      throwIfAborted(signal);
      const result = await runPreProvider(contextProvider.provider, {
        configName: contextProvider.config,
        jobName: job.name,
        channelId: job.channel,
        runAt,
      });
      if (result.skipTask) {
        const message = result.skipTask.message
          ? `${result.skipTask.reason}: ${result.skipTask.message}`
          : result.skipTask.reason;
        if (contextProvider.required) {
          await channel.send(`⏰ cron \`${job.name}\` ❌ context provider ${contextProvider.provider} skipped: ${message.slice(0, 1200)}`);
          throw new CronTaskRunError(`context provider ${contextProvider.provider} skipped: ${message}`, {
            providerName: contextProvider.provider,
            providerStatus: "skipped",
            providerCategory: result.skipTask.reason,
            errorCategory: result.skipTask.reason,
          });
        }
        log.warn(`${job.name} optional context provider ${contextProvider.provider} skipped: ${message}`);
        prependedContext += buildCronPreProviderBlock(
          contextProvider.provider,
          JSON.stringify({ source: contextProvider.provider, status: "skipped", reason: message }, null, 2)
        );
      } else {
        prependedContext += buildCronPreProviderBlock(contextProvider.provider, result.text);
      }
      if (result.commit) commits.push(result.commit);
    } catch (err) {
      if (err instanceof CronTaskRunError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (contextProvider.required) {
        await channel.send(`⏰ cron \`${job.name}\` ❌ context provider ${contextProvider.provider} 失败: ${msg.slice(0, 1200)}`);
        throw new CronTaskRunError(`context provider ${contextProvider.provider} failed: ${msg}`, {
          providerName: contextProvider.provider,
          providerStatus: "failed",
          providerCategory: categorizeProviderError(err),
          errorCategory: categorizeProviderError(err),
        });
      }
      log.warn(`${job.name} optional context provider ${contextProvider.provider} failed:`, err);
      prependedContext += buildCronPreProviderBlock(
        contextProvider.provider,
        JSON.stringify({
          source: contextProvider.provider,
          status: "failed",
          warning: "Optional context provider failed; continue with the primary cron provider.",
          error: msg.slice(0, 500),
        }, null, 2)
      );
    }
  }

  return { prependedContext, commits };
}

export async function runTask(job: CronJobTask, client: Client, context: CronJobRunContext = {}): Promise<CronJobRunOutcome> {
  throwIfAborted(context.signal);
  assertNotDraining(job.name);
  const runAt = cronRunAt();
  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    const msg = `${job.name} skipped: hit MINICLAW_MAX_CONCURRENT_TASKS=${config.maxConcurrentTasks}`;
    log.warn(msg);
    throw new CronTaskRunError(msg);
  }
  const channel = await fetchSendableChannel(client, job.channel);
  throwIfAborted(context.signal);
  const taskId = uuid();
  const cwd = resolveHome(job.cwd ?? config.defaultCwd);

  // 如果配了 pre_script，先跑它，把 stdout 拼到 prompt 顶部
  let prependedContext = "";
  const preContextProviderCommits: Array<() => Promise<void>> = [];
  let preProviderCommit: (() => Promise<void>) | undefined;
  const preProviderAttachments: PreProviderAttachment[] = [];
  let marketIntelPayload: MarketIntelPayload | undefined;
  let marketContextPayload: MarketContextProviderPayload | undefined;
  const contextProviderResult = await runPreContextProviders(job, channel, runAt, context.signal);
  prependedContext += contextProviderResult.prependedContext;
  preContextProviderCommits.push(...contextProviderResult.commits);
  if (job.pre_script) {
    try {
      const stdout = await runPreScript(
        job.pre_script,
        job.pre_script_args ?? [],
        job.pre_script_timeout_sec ?? 120,
        job.name,
        job.channel,
        runAt,
        context.signal,
      );
      prependedContext += buildCronPreScriptBlock(job.pre_script, stdout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await channel.send(`⏰ cron \`${job.name}\` ❌ pre_script 失败: ${msg.slice(0, 1500)}`);
      throw new CronTaskRunError(`pre_script failed: ${msg}`);
    }
  }
  if (job.pre_provider) {
    if (job.pre_provider_preflight && job.pre_provider_preflight !== "off") {
      try {
        await runPreProviderPreflight(job, runAt, context.signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const mode = preflightModeLabel(job.pre_provider_preflight);
        await channel.send(`⏰ cron \`${job.name}\` ❌ pre_provider ${mode} preflight 失败: ${msg.slice(0, 1500)}`);
        const providerCategory = stringField(err, "providerCategory");
        throw new CronTaskRunError(`pre_provider ${mode} preflight failed: ${msg}`, {
          providerName: job.pre_provider,
          providerStatus: preflightProviderStatus(job.pre_provider_preflight),
          providerCategory,
          errorCategory: stringField(err, "errorCategory") ?? providerCategory ?? "provider_preflight_failed",
        });
      }
    }
    try {
      throwIfAborted(context.signal);
      const result = await runPreProvider(job.pre_provider, {
        configName: job.pre_provider_config,
        jobName: job.name,
        channelId: job.channel,
        runAt,
      });
      prependedContext += buildCronPreProviderBlock(job.pre_provider, result.text);
      if (job.pre_provider === "market-intel") {
        marketIntelPayload = parseMarketIntelPayload(result.text);
      }
      if (job.pre_provider === "market-context") {
        marketContextPayload = parseMarketContextProviderPayload(result.text);
      }
      preProviderCommit = result.commit;
      if (result.attachments?.length) {
        preProviderAttachments.push(...result.attachments);
      }
      if (result.skipTask) {
        const skipMessage = result.skipTask.message
          ? `${result.skipTask.reason}: ${result.skipTask.message}`
          : result.skipTask.reason;
        log.info(`${job.name} skipped by pre_provider ${job.pre_provider}: ${skipMessage}`);
        if (result.skipTask.notifyMessage) {
          await channel.send(result.skipTask.notifyMessage.slice(0, 1900));
        }
        return {
          status: "skipped",
          providerName: job.pre_provider,
          providerStatus: "skipped",
          providerCategory: result.skipTask.reason,
          errorCategory: result.skipTask.reason,
          errorMessage: result.skipTask.message,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await channel.send(`⏰ cron \`${job.name}\` ❌ pre_provider 失败: ${msg.slice(0, 1500)}`);
      const providerCategory = categorizeProviderError(err);
      throw new CronTaskRunError(`pre_provider failed: ${msg}`, {
        providerName: job.pre_provider,
        providerStatus: "failed",
        providerCategory,
        errorCategory: providerCategory,
      });
    }
  }

  throwIfAborted(context.signal);
  const renderedPrompt = renderTemplate(job.prompt, { "cron.name": job.name });
  const outputContract = resolveCronOutputContract(job);
  const outputContractBlock = buildCronOutputContractBlock(outputContract);
  const prompt = buildCronTaskPrompt(job.name, prependedContext, renderedPrompt, outputContractBlock);

  assertNotDraining(job.name);
  createTask({
    id: taskId,
    // cron 触发的 task 不属于任何 Discord thread，置空避免被 thread-continuation 误命中
    discord_thread_id: "",
    discord_user_id: "cron",
    prompt,
    cwd,
    source_route_type: "cron_task",
    source_channel_id: job.channel,
  });
  context.onTaskId?.(taskId);
  const marketForecastId = marketIntelPayload
    ? recordMarketForecastFromPayload({ taskId, payload: marketIntelPayload })
    : undefined;
  const reporter = new TaskReporter(taskId);
  reporter.accepted({
    route: "cron_task",
    cron_name: job.name,
    cwd,
    channel_id: job.channel,
    has_pre_script: Boolean(job.pre_script),
    has_pre_provider: Boolean(job.pre_provider),
    pre_context_provider_count: job.pre_context_providers?.length ?? 0,
  });
  reporter.contextCaptured({
    source_route_type: "cron_task",
    source_channel_id: job.channel,
    prepended_context_chars: prependedContext.length,
  });
  const viewReporter = job.result_delivery?.mode === "daily_message_group"
    ? new DailyMessageGroupReporter({
        taskId,
        channel,
        channelId: job.channel,
        jobName: job.name,
        runAt,
        timezone: job.result_delivery.timezone ?? job.timezone ?? "UTC",
        route: "cron_task",
        onDeliveryError: (operation, err) => reporter.discordDeliveryFailed(operation, err),
      })
    : undefined;
  let result: TaskResult;
  try {
    result = await executeTask({
      taskId,
      prompt,
      cwd,
      channel,
      outputMode: "raw",
      ...(viewReporter ? { viewReporter } : {}),
      signal: context.signal,
      deliveryChannelId: job.channel,
      deliveryContext: { route: "cron_task", jobName: job.name },
      ...(marketForecastId || marketContextPayload?.mode === "update"
        ? { rawOutputTextTransform: stripMachineJsonForDisplay }
        : {}),
    });
  } catch (err) {
    throw attachCronTaskRunMetadata(err, {
      taskId,
      ...(job.pre_provider ? { providerName: job.pre_provider, providerStatus: "failed" } : {}),
    });
  }
  assertTaskResultOk(job.name, result, {
    taskId,
    ...(job.pre_provider ? { providerName: job.pre_provider, providerStatus: "failed" } : {}),
  });
  const outputValidation = validateCronTaskOutput(outputContract, result.result);
  if (!outputValidation.ok) {
    throw new CronTaskRunError(`${job.name} output validation failed: ${outputValidation.message}`, {
      taskId,
      errorCategory: outputValidation.category,
      ...(job.pre_provider ? { providerName: job.pre_provider, providerStatus: "failed" } : {}),
    });
  }
  if (marketForecastId) {
    const extraction = updateMarketForecastReport(marketForecastId, result.result);
    reporter.contextCaptured({
      source_route_type: "market_forecast_persistence",
      forecast_id: marketForecastId,
      llm_forecast_json: extraction.hasJson,
      llm_forecast_items: extraction.insertedItemCount,
    });
  }
  if (marketContextPayload?.mode === "update") {
    const targetScope = marketContextPayload.run_context.target_market_scope;
    if (!targetScope) {
      throw new CronTaskRunError(`${job.name} market-context update missing target_market_scope`, { taskId });
    }
    const update = recordMarketContextFromReport({
      taskId,
      jobName: job.name,
      channelId: job.channel,
      marketScope: targetScope,
      generatedAt: marketContextPayload.generated_at,
      tradeDate: marketContextPayload.run_context.trade_date,
      sourcePayload: marketContextPayload,
      reportText: result.result,
    });
    reporter.contextCaptured({
      source_route_type: "market_context_persistence",
      market_context_daily_id: update.dailyId,
      market_context_json: update.hasJson,
      market_context_items: update.upsertedItemCount,
    });
    if (!update.hasJson) {
      throw new CronTaskRunError(`${job.name} market-context update did not include a valid <market_context_json> block`, { taskId });
    }
  }
  await sendExtraCronResultDelivery(
    client,
    job,
    marketForecastId || marketContextPayload?.mode === "update"
      ? stripMachineJsonForDisplay(result.result)
      : result.result,
  );
  await sendPreProviderAttachments(channel, job.name, preProviderAttachments);
  for (const commit of preContextProviderCommits) {
    await commit();
  }
  if (preProviderCommit) {
    await preProviderCommit();
  }
  return {
    status: "success",
    taskId,
    ...(job.pre_provider ? { providerName: job.pre_provider, providerStatus: "ok" } : {}),
  };
}

export async function runSkill(job: CronJobSkill, client: Client, context: CronJobRunContext = {}): Promise<CronJobRunOutcome> {
  throwIfAborted(context.signal);
  assertNotDraining(job.name);
  if (getActiveTaskCount() >= config.maxConcurrentTasks) {
    const msg = `${job.name} skipped: hit MINICLAW_MAX_CONCURRENT_TASKS=${config.maxConcurrentTasks}`;
    log.warn(msg);
    throw new CronTaskRunError(msg);
  }
  const channel = await fetchSendableChannel(client, job.channel);
  throwIfAborted(context.signal);
  const taskId = uuid();
  const cwd = resolveHome(job.cwd ?? config.defaultCwd);

  // 把 skill 调用拼成一段明确的 supervisor prompt
  const prompt = buildCronSkillPrompt(job.name, job.skill, job.skill_args);

  assertNotDraining(job.name);
  createTask({
    id: taskId,
    discord_thread_id: "",
    discord_user_id: "cron",
    prompt,
    cwd,
    source_route_type: "cron_skill",
    source_channel_id: job.channel,
  });
  context.onTaskId?.(taskId);
  const reporter = new TaskReporter(taskId);
  reporter.accepted({
    route: "cron_skill",
    cron_name: job.name,
    cwd,
    channel_id: job.channel,
    skill: job.skill,
  });
  reporter.contextCaptured({
    source_route_type: "cron_skill",
    source_channel_id: job.channel,
    skill: job.skill,
  });
  let result: TaskResult;
  try {
    result = await executeTask({
      taskId,
      prompt,
      cwd,
      channel,
      outputMode: "raw",
      signal: context.signal,
      deliveryChannelId: job.channel,
      deliveryContext: { route: "cron_skill", jobName: job.name },
    });
  } catch (err) {
    throw attachCronTaskRunMetadata(err, { taskId });
  }
  assertTaskResultOk(job.name, result, { taskId });
  await sendExtraCronResultDelivery(client, job, result.result);
  return { status: "success", taskId };
}

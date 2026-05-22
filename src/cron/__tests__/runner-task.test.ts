import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CronJobTask } from "../types.js";
import { __clearPromptCache } from "../../agent/prompts.js";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  executeTask: vi.fn(),
  getActiveTaskCount: vi.fn(() => 0),
  runPreProvider: vi.fn(),
  runProviderHealthCheck: vi.fn(),
  runProviderDryRun: vi.fn(),
  recordMarketContextFromReport: vi.fn(() => ({ hasJson: true, dailyId: "market-context-1", upsertedItemCount: 2 })),
  recordMarketForecastFromPayload: vi.fn(() => "forecast-1"),
  updateMarketForecastReport: vi.fn(() => ({ hasJson: true, insertedItemCount: 4 })),
}));

let promptTmp: string | undefined;

vi.mock("../../store/db.js", () => ({
  createTask: mocks.createTask,
}));

vi.mock("../../store/market-forecasts.js", () => ({
  recordMarketForecastFromPayload: mocks.recordMarketForecastFromPayload,
  stripMarketForecastJsonForDisplay: (text: string) => text.replace(/<market_forecast_json>[\s\S]*?<\/market_forecast_json>/g, "").trim(),
  updateMarketForecastReport: mocks.updateMarketForecastReport,
}));

vi.mock("../../store/market-context.js", () => ({
  recordMarketContextFromReport: mocks.recordMarketContextFromReport,
  stripMarketContextJsonForDisplay: (text: string) => text.replace(/<market_context_json>[\s\S]*?<\/market_context_json>/g, "").trim(),
}));

vi.mock("../../agent/task.js", () => ({
  executeTask: mocks.executeTask,
  getActiveTaskCount: mocks.getActiveTaskCount,
}));

vi.mock("../../agent/task-reporter.js", () => ({
  TaskReporter: class {
    accepted(): undefined { return undefined; }
    contextCaptured(): undefined { return undefined; }
  },
}));

vi.mock("../../providers/index.js", () => ({
  runPreProvider: mocks.runPreProvider,
  runProviderHealthCheck: mocks.runProviderHealthCheck,
  runProviderDryRun: mocks.runProviderDryRun,
}));

function taskJob(): CronJobTask {
  return {
    name: "daily-ai-news",
    schedule: "* * * * *",
    enabled: true,
    type: "task",
    channel: "1000000000000000000",
    prompt: "summarize AI news",
  };
}

function client(send = vi.fn(async () => ({ id: "message-1" }))): Client {
  return {
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send,
      }),
    },
  } as unknown as Client;
}

beforeEach(() => {
  delete process.env.MINICLAW_CRON_TEST_RUN_AT;
  promptTmp = mkdtempSync(join(tmpdir(), "miniclaw-cron-prompts-"));
  process.env.MINICLAW_PROMPTS_DIR = promptTmp;
  __clearPromptCache();
  mocks.createTask.mockReset();
  mocks.executeTask.mockReset();
  mocks.getActiveTaskCount.mockReset();
  mocks.getActiveTaskCount.mockReturnValue(0);
  mocks.runPreProvider.mockReset();
  mocks.runProviderHealthCheck.mockReset();
  mocks.runProviderDryRun.mockReset();
  mocks.recordMarketContextFromReport.mockReset();
  mocks.recordMarketContextFromReport.mockReturnValue({ hasJson: true, dailyId: "market-context-1", upsertedItemCount: 2 });
  mocks.recordMarketForecastFromPayload.mockReset();
  mocks.recordMarketForecastFromPayload.mockReturnValue("forecast-1");
  mocks.updateMarketForecastReport.mockReset();
  mocks.updateMarketForecastReport.mockReturnValue({ hasJson: true, insertedItemCount: 4 });
});

afterEach(() => {
  if (promptTmp) rmSync(promptTmp, { recursive: true, force: true });
  promptTmp = undefined;
  delete process.env.MINICLAW_PROMPTS_DIR;
  __clearPromptCache();
});

describe("cron task runner", () => {
  it("throws when the underlying task returns success=false so scheduler can retry", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.executeTask.mockResolvedValue({
      success: false,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1800000,
      turns: 1,
      result: "The operation was aborted",
    });

    let error: unknown;
    try {
      await runTask(taskJob(), client());
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("daily-ai-news task failed: The operation was aborted");
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      source_route_type: "cron_task",
      source_channel_id: "1000000000000000000",
    }));
    const createdTask = mocks.createTask.mock.calls[0]?.[0] as { id?: string } | undefined;
    expect((error as { taskId?: string }).taskId).toBe(createdTask?.id);
  });

  it("resolves when the underlying task succeeds", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    await expect(runTask(taskJob(), client())).resolves.toMatchObject({
      status: "success",
      taskId: expect.any(String),
    });
  });

  it("keeps the task prompt unchanged when no output contract is configured", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    await runTask(taskJob(), client());

    const taskInput = mocks.executeTask.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(taskInput?.prompt).toBe("[cron:daily-ai-news]\n\nsummarize AI news");
  });

  it("injects a rendered output contract into createTask and executeTask prompts", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "## Summary\nok",
    });

    await runTask({
      ...taskJob(),
      output_contract: {
        template: "Use Markdown suitable for {{audience}} readers.\n\n## Key Findings",
        vars: { audience: "operator" },
        validator: "none",
      },
    }, client());

    const createdTask = mocks.createTask.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    const taskInput = mocks.executeTask.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    const prompt = taskInput?.prompt ?? "";
    expect(createdTask?.prompt).toBe(taskInput?.prompt);
    expect(prompt).toContain('<cron_output_contract source="cron-yaml" validator="none">');
    expect(prompt).toContain("Output surface policy:");
    expect(prompt).toContain("Use concise Markdown suitable for chat/IM delivery.");
    expect(prompt).toContain("Avoid Markdown pipe tables; use bullets, compact sections, or lists instead.");
    expect(prompt).toContain("Job-specific output template:");
    expect(prompt).toContain("Use Markdown suitable for operator readers.");
    expect(prompt).toContain("## Key Findings");
    expect(prompt).toContain("summarize AI news");
    expect(prompt.indexOf("Output surface policy:")).toBeLessThan(
      prompt.indexOf("Job-specific output template:")
    );
    expect(prompt.indexOf("Job-specific output template:")).toBeLessThan(
      prompt.indexOf("Use Markdown suitable for operator readers.")
    );
  });

  it("uses a daily message group reporter when configured", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    await runTask({
      ...taskJob(),
      result_delivery: {
        mode: "daily_message_group",
        timezone: "Asia/Shanghai",
      },
    }, client());

    const params = mocks.executeTask.mock.calls[0]?.[0] as { viewReporter?: unknown; outputMode?: string } | undefined;
    expect(params?.outputMode).toBe("raw");
    expect(params?.viewReporter).toBeDefined();
  });

  it("skips the downstream task when a pre_provider returns skipTask", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.runPreProvider.mockResolvedValue({
      text: "{\"transaction_count\":0}",
      skipTask: {
        reason: "no_matching_cmb_credit_card_email",
        message: "transactions=0",
      },
    });

    await expect(runTask({
      ...taskJob(),
      pre_provider: "cmb-credit-card-email",
      pre_provider_config: "default",
    }, client())).resolves.toMatchObject({
      status: "skipped",
      providerName: "cmb-credit-card-email",
      errorCategory: "no_matching_cmb_credit_card_email",
      errorMessage: "transactions=0",
    });

    expect(mocks.runPreProvider).toHaveBeenCalledWith("cmb-credit-card-email", expect.objectContaining({
      configName: "default",
      jobName: "daily-ai-news",
      channelId: "1000000000000000000",
    }));
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.executeTask).not.toHaveBeenCalled();
  });

  it("sends a user-facing notice when a pre_provider skip asks for notification", async () => {
    const { runTask } = await import("../runner-task.js");
    const send = vi.fn(async () => ({ id: "message-1" }));
    mocks.runPreProvider.mockResolvedValue({
      text: "{\"status\":\"skipped\"}",
      skipTask: {
        reason: "wechat_mp_session_invalid",
        message: "appmsgpublish: invalid session (200003 invalid session)",
        notifyMessage: "需要重新登录微信公众号后台 session",
      },
    });

    await expect(runTask({
      ...taskJob(),
      pre_provider: "wechat-mp",
      pre_provider_config: "daily-ai-wechat",
    }, client(send))).resolves.toMatchObject({
      status: "skipped",
      providerName: "wechat-mp",
      errorCategory: "wechat_mp_session_invalid",
    });

    expect(send).toHaveBeenCalledWith("需要重新登录微信公众号后台 session");
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.executeTask).not.toHaveBeenCalled();
  });

  it("persists market-intel forecasts before and after the raw cron task", async () => {
    const { runTask } = await import("../runner-task.js");
    const providerPayload = {
      generated_at: "2026-05-08T12:45:00.000Z",
      source: "market-intel",
      profile: "us-pre-market",
      market_scope: "us",
      session: "pre_market",
      run_context: {
        job_name: "us-stock-pre-market",
        channel_id: "1000000000000000000",
        timezone: "America/New_York",
        calendar_status: "pre_market",
        trade_date: "2026-05-08",
        skipped: false,
        open_markets: [],
        tradable_markets: ["us"],
        closed_markets: [],
      },
      data_quality: { status: "partial", warnings: [], sources: [] },
      scores: {
        index_direction: {
          target: "US broad market",
          direction: "bullish",
          probability: 0.55,
          confidence: 0.4,
          evidence_ids: ["quote.indices.1"],
          rationale: "positive snapshot",
        },
        sector_opportunities: [],
        risk_level: {
          target: "market risk",
          direction: "neutral",
          probability: 0.5,
          confidence: 0.2,
          evidence_ids: ["calendar.static.1"],
          rationale: "calendar known",
        },
      },
    };
    mocks.runPreProvider.mockResolvedValue({ text: JSON.stringify(providerPayload) });
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "<market_forecast_json>{\"index_probabilities\":[{\"target\":\"SPY\",\"up\":0.4,\"range_bound\":0.4,\"down\":0.2}]}</market_forecast_json>",
    });

    await expect(runTask({
      ...taskJob(),
      name: "us-stock-pre-market",
      pre_provider: "market-intel",
      pre_provider_config: "us-pre-market",
    }, client())).resolves.toMatchObject({
      status: "success",
      taskId: expect.any(String),
      providerName: "market-intel",
    });

    const createdTask = mocks.createTask.mock.calls[0]?.[0] as { id?: string } | undefined;
    expect(createdTask?.id).toBeDefined();
    expect(mocks.recordMarketForecastFromPayload).toHaveBeenCalledWith({
      taskId: createdTask?.id,
      payload: expect.objectContaining({
        source: "market-intel",
        market_scope: "us",
      }),
    });
    expect(mocks.updateMarketForecastReport).toHaveBeenCalledWith("forecast-1", expect.stringContaining("market_forecast_json"));
    expect(mocks.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      outputMode: "raw",
      rawOutputTextTransform: expect.any(Function),
    }));
  });

  it("passes MINICLAW_CRON_TEST_RUN_AT to pre_provider for controlled cron tests", async () => {
    process.env.MINICLAW_CRON_TEST_RUN_AT = "2026-05-08T12:45:00.000Z";
    const { runTask } = await import("../runner-task.js");
    mocks.runPreProvider.mockResolvedValue({
      text: "{\"status\":\"ok\"}",
      skipTask: { reason: "controlled_test_stop", message: "stop before task" },
    });

    await expect(runTask({
      ...taskJob(),
      pre_provider: "stock-portfolio",
      pre_provider_config: "us-stock",
    }, client())).resolves.toMatchObject({
      status: "skipped",
      errorCategory: "controlled_test_stop",
    });

    expect(mocks.runPreProvider).toHaveBeenCalledWith("stock-portfolio", expect.objectContaining({
      runAt: new Date("2026-05-08T12:45:00.000Z"),
    }));
  });

  it("runs provider health preflight before the legacy pre_provider when configured", async () => {
    process.env.MINICLAW_CRON_TEST_RUN_AT = "2026-05-08T12:45:00.000Z";
    const { runTask } = await import("../runner-task.js");
    mocks.runProviderHealthCheck.mockResolvedValue({
      ok: true,
      message: "stock-pulse config is loadable",
      checkedAt: "2026-05-08T12:45:00.000Z",
    });
    mocks.runPreProvider.mockResolvedValue({ text: "{\"status\":\"ok\"}" });
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    await expect(runTask({
      ...taskJob(),
      pre_provider: "stock-pulse",
      pre_provider_config: "us-hourly",
      pre_provider_preflight: "health",
    }, client())).resolves.toMatchObject({
      status: "success",
      providerName: "stock-pulse",
    });

    expect(mocks.runProviderHealthCheck).toHaveBeenCalledWith("stock-pulse", expect.objectContaining({
      configName: "us-hourly",
      jobName: "daily-ai-news",
      channelId: "1000000000000000000",
      runAt: new Date("2026-05-08T12:45:00.000Z"),
    }));
    expect(mocks.runProviderHealthCheck.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.runPreProvider.mock.invocationCallOrder[0]);
    expect(mocks.executeTask).toHaveBeenCalled();
  });

  it("stops before provider collection and task execution when health preflight fails", async () => {
    const { runTask } = await import("../runner-task.js");
    const send = vi.fn(async () => ({ id: "message-1" }));
    mocks.runProviderHealthCheck.mockResolvedValue({
      ok: false,
      category: "config",
      message: "stock-pulse provider config missing",
      checkedAt: "2026-05-08T12:45:00.000Z",
    });

    let error: unknown;
    await runTask({
      ...taskJob(),
      pre_provider: "stock-pulse",
      pre_provider_config: "missing",
      pre_provider_preflight: "health",
    }, client(send)).catch((err: unknown) => {
      error = err;
    });

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("pre_provider health preflight failed: config: stock-pulse provider config missing");
    expect(error).toMatchObject({
      providerName: "stock-pulse",
      providerStatus: "health_failed",
      providerCategory: "config",
      errorCategory: "config",
    });
    expect(send).toHaveBeenCalledWith(expect.stringContaining("pre_provider health preflight 失败"));
    expect(mocks.runPreProvider).not.toHaveBeenCalled();
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.executeTask).not.toHaveBeenCalled();
  });

  it("runs provider dry-run preflight without injecting dry-run output into the prompt", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.runProviderDryRun.mockResolvedValue({
      ok: true,
      structured: { position_count: 2 },
      previewText: "{\"position_count\":2}",
      redacted: true,
      warnings: [],
    });
    mocks.runPreProvider.mockResolvedValue({ text: "{\"real_provider_payload\":true}" });
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    await expect(runTask({
      ...taskJob(),
      pre_provider: "stock-pulse",
      pre_provider_config: "us-hourly",
      pre_provider_preflight: "dry_run",
    }, client())).resolves.toMatchObject({
      status: "success",
      providerName: "stock-pulse",
    });

    expect(mocks.runProviderDryRun).toHaveBeenCalledWith("stock-pulse", expect.objectContaining({
      configName: "us-hourly",
    }));
    expect(mocks.runPreProvider).toHaveBeenCalled();
    const taskInput = mocks.executeTask.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(taskInput?.prompt).toContain("\"real_provider_payload\":true");
    expect(taskInput?.prompt).not.toContain("\"position_count\":2");
  });

  it("prepends optional pre_context_providers before the primary pre_provider", async () => {
    const { runTask } = await import("../runner-task.js");
    mocks.runPreProvider.mockImplementation(async (provider: string) => {
      if (provider === "market-context") {
        return {
          text: JSON.stringify({
            source: "market-context",
            generated_at: "2026-05-17T12:00:00.000Z",
            profile: "us-inject",
            mode: "inject",
            run_context: {
              job_name: "us-stock-hourly-pulse",
              channel_id: "1000000000000000000",
              timezone: "America/New_York",
              trade_date: "2026-05-17",
              requested_market_scopes: ["us", "cross-market"],
            },
            previous_contexts: [],
            active_items: [{ topic: "Fed", fact: "FOMC risk remains active" }],
            usage_notes: [],
          }),
        };
      }
      return { text: "{\"real_provider_payload\":true}" };
    });
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    await expect(runTask({
      ...taskJob(),
      name: "us-stock-hourly-pulse",
      pre_context_providers: [{ provider: "market-context", config: "us-inject" }],
      pre_provider: "stock-pulse",
      pre_provider_config: "us-hourly",
    }, client())).resolves.toMatchObject({
      status: "success",
      providerName: "stock-pulse",
    });

    expect(mocks.runPreProvider).toHaveBeenNthCalledWith(1, "market-context", expect.objectContaining({
      configName: "us-inject",
      jobName: "us-stock-hourly-pulse",
    }));
    expect(mocks.runPreProvider).toHaveBeenNthCalledWith(2, "stock-pulse", expect.objectContaining({
      configName: "us-hourly",
      jobName: "us-stock-hourly-pulse",
    }));
    const taskInput = mocks.executeTask.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(taskInput?.prompt).toContain("FOMC risk remains active");
    expect(taskInput?.prompt).toContain("\"real_provider_payload\":true");
  });

  it("persists market-context update reports and strips machine JSON from raw delivery", async () => {
    const { runTask } = await import("../runner-task.js");
    const providerPayload = {
      source: "market-context",
      generated_at: "2026-05-17T22:30:00.000Z",
      profile: "us-update",
      mode: "update",
      run_context: {
        job_name: "us-market-context-daily",
        channel_id: "1000000000000000000",
        timezone: "America/New_York",
        trade_date: "2026-05-17",
        target_market_scope: "us",
        requested_market_scopes: ["us"],
      },
      previous_contexts: [],
      active_items: [],
      usage_notes: [],
    };
    mocks.runPreProvider.mockResolvedValue({ text: JSON.stringify(providerPayload) });
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: [
        "## Rolling market context",
        "Fed repricing remains the dominant driver.",
        "<market_context_json>{\"market_scope\":\"us\",\"trade_date\":\"2026-05-17\",\"digest_text\":\"Fed repricing remains dominant\",\"active_items\":[{\"stable_key\":\"fed-policy\",\"topic\":\"Fed policy\",\"fact\":\"Rates remain the main risk\",\"market_impact\":\"higher yield volatility\",\"confidence\":0.7}]}</market_context_json>",
      ].join("\n"),
    });

    await expect(runTask({
      ...taskJob(),
      name: "us-market-context-daily",
      pre_provider: "market-context",
      pre_provider_config: "us-update",
    }, client())).resolves.toMatchObject({
      status: "success",
      providerName: "market-context",
    });

    const createdTask = mocks.createTask.mock.calls[0]?.[0] as { id?: string } | undefined;
    expect(mocks.recordMarketContextFromReport).toHaveBeenCalledWith({
      taskId: createdTask?.id,
      jobName: "us-market-context-daily",
      channelId: "1000000000000000000",
      marketScope: "us",
      generatedAt: "2026-05-17T22:30:00.000Z",
      tradeDate: "2026-05-17",
      sourcePayload: providerPayload,
      reportText: expect.stringContaining("market_context_json"),
    });
    const taskInput = mocks.executeTask.mock.calls[0]?.[0] as { rawOutputTextTransform?: (text: string) => string } | undefined;
    expect(taskInput?.rawOutputTextTransform?.("<market_context_json>{}</market_context_json>\nvisible")).toBe("visible");
  });

  it("stops before provider collection and annotates dry-run preflight failures", async () => {
    const { runTask } = await import("../runner-task.js");
    const send = vi.fn(async () => ({ id: "message-1" }));
    mocks.runProviderDryRun.mockResolvedValue({
      ok: false,
      category: "auth",
      previewText: "session expired",
      redacted: true,
      warnings: [],
    });

    let error: unknown;
    await runTask({
      ...taskJob(),
      pre_provider: "stock-pulse",
      pre_provider_config: "us-hourly",
      pre_provider_preflight: "dry_run",
    }, client(send)).catch((err: unknown) => {
      error = err;
    });

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("pre_provider dry-run preflight failed: auth: session expired");
    expect(error).toMatchObject({
      providerName: "stock-pulse",
      providerStatus: "dry_run_failed",
      providerCategory: "auth",
      errorCategory: "auth",
    });
    expect(send).toHaveBeenCalledWith(expect.stringContaining("pre_provider dry-run preflight 失败"));
    expect(mocks.runPreProvider).not.toHaveBeenCalled();
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.executeTask).not.toHaveBeenCalled();
  });

  it("uploads pre_provider attachments after a successful raw cron task", async () => {
    const { runTask } = await import("../runner-task.js");
    const tmp = mkdtempSync(join(tmpdir(), "miniclaw-cron-task-attachments-"));
    const chartPath = join(tmp, "chart.png");
    writeFileSync(chartPath, "png");
    const send = vi.fn(async () => ({ id: "message-1" }));
    mocks.runPreProvider.mockResolvedValue({
      text: "{\"asset_summary\":{}}",
      attachments: [{
        path: chartPath,
        name: "asset-pie.png",
        description: "asset pie",
      }],
    });
    mocks.executeTask.mockResolvedValue({
      success: true,
      sessionId: "codex:thread-1",
      costUsd: 0,
      durationMs: 1000,
      turns: 1,
      result: "ok",
    });

    try {
      await expect(runTask({
        ...taskJob(),
        pre_provider: "stock-portfolio",
        pre_provider_config: "daily-stock-summary",
      }, client(send))).resolves.toMatchObject({
        status: "success",
        providerName: "stock-portfolio",
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("附图"),
      files: expect.arrayContaining([expect.anything()]),
    }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CronJobTask } from "../types.js";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  executeTask: vi.fn(),
  getActiveTaskCount: vi.fn(() => 0),
  runPreProvider: vi.fn(),
  recordMarketForecastFromPayload: vi.fn(() => "forecast-1"),
  updateMarketForecastReport: vi.fn(() => ({ hasJson: true, insertedItemCount: 4 })),
}));

vi.mock("../../store/db.js", () => ({
  createTask: mocks.createTask,
}));

vi.mock("../../store/market-forecasts.js", () => ({
  recordMarketForecastFromPayload: mocks.recordMarketForecastFromPayload,
  stripMarketForecastJsonForDisplay: (text: string) => text.replace(/<market_forecast_json>[\s\S]*?<\/market_forecast_json>/g, "").trim(),
  updateMarketForecastReport: mocks.updateMarketForecastReport,
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
  mocks.createTask.mockReset();
  mocks.executeTask.mockReset();
  mocks.getActiveTaskCount.mockReset();
  mocks.getActiveTaskCount.mockReturnValue(0);
  mocks.runPreProvider.mockReset();
  mocks.recordMarketForecastFromPayload.mockReset();
  mocks.recordMarketForecastFromPayload.mockReturnValue("forecast-1");
  mocks.updateMarketForecastReport.mockReset();
  mocks.updateMarketForecastReport.mockReturnValue({ hasJson: true, insertedItemCount: 4 });
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

    await expect(runTask(taskJob(), client())).rejects.toThrow(
      "daily-ai-news task failed: The operation was aborted",
    );
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      source_route_type: "cron_task",
      source_channel_id: "1000000000000000000",
    }));
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

    await expect(runTask(taskJob(), client())).resolves.toBeUndefined();
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
    }, client())).resolves.toBeUndefined();

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
    }, client(send))).resolves.toBeUndefined();

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
    }, client())).resolves.toBeUndefined();

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
    }, client())).resolves.toBeUndefined();

    expect(mocks.runPreProvider).toHaveBeenCalledWith("stock-portfolio", expect.objectContaining({
      runAt: new Date("2026-05-08T12:45:00.000Z"),
    }));
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
      }, client(send))).resolves.toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("附图"),
      files: expect.arrayContaining([expect.anything()]),
    }));
  });
});

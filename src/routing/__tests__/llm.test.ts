import { describe, expect, it, vi } from "vitest";
import type { ModelClassificationInput, ModelClient } from "../../runtime/model-client.js";
import { __testables } from "../llm.js";

describe("capability LLM classifier helpers", () => {
  it("parses snake_case capability JSON", () => {
    const parsed = __testables.parseCapabilityJson(JSON.stringify({
      needs_current_info: true,
      needs_multi_step_research: true,
      needs_file_write: false,
      needs_shell: false,
      needs_git: false,
      needs_browser: false,
      needs_runtime_inspection: false,
      needs_long_running: true,
      creates_persistent_output: false,
      has_external_url: true,
      has_attachments: false,
      is_url_only: false,
      estimated_effort: "medium",
      confidence: 0.83,
      reason: "requires current GitHub activity analysis",
      evidence: ["github_activity", "current_info"],
      risk_flags: ["long_running_research"],
      user_intent: "explain current contribution spike",
      ambiguity: "low",
    }));

    expect(parsed.needsCurrentInfo).toBe(true);
    expect(parsed.needsMultiStepResearch).toBe(true);
    expect(parsed.needsLongRunning).toBe(true);
    expect(parsed.hasExternalUrl).toBe(true);
    expect(parsed.isUrlOnly).toBe(false);
    expect(parsed.estimatedEffort).toBe("medium");
    expect(parsed.confidence).toBe(0.83);
    expect(parsed.matchedSignals).toContain("llm_classifier");
    expect(parsed.userIntent).toBe("explain current contribution spike");
    expect(parsed.ambiguity).toBe("low");
  });

  it("builds an LLM-first capability prompt without heuristic hints or direct routing", () => {
    const prompt = __testables.classifierPrompt({
      content: "帮我分析最近 GitHub activity",
      channelId: "chat-1",
      hasAttachments: false,
    });

    expect(prompt).toContain("Classify the capabilities needed");
    expect(prompt).toContain("Routing policy is NOT your job");
    expect(prompt).toContain("Do not use keyword matching");
    expect(prompt).toContain("steipete的1099 次贡献");
    expect(prompt).toContain("stock-pulse");
    expect(prompt).toContain("needs_current_info");
    expect(prompt).not.toContain("Heuristic capability hints");
    expect(prompt).not.toContain('"intent"');
  });

  it("routes capability classification through the ModelClient contract", async () => {
    const complete = vi.fn();
    let classifyCalls = 0;
    let classifyInput: ModelClassificationInput<unknown> | undefined;
    const classify = async <T>(input: ModelClassificationInput<T>): Promise<T> => {
      classifyCalls++;
      classifyInput = input as unknown as ModelClassificationInput<unknown>;
      return input.parse(JSON.stringify({
        needs_current_info: false,
        needs_multi_step_research: false,
        needs_file_write: false,
        needs_shell: false,
        estimated_effort: "short",
        confidence: 0.77,
        reason: "short conceptual answer",
        evidence: ["model_client"],
      }));
    };
    const client: ModelClient = {
      id: "router-test-client",
      kind: "model_client",
      complete,
      classify,
    };

    const parsed = await __testables.classifyRouteWithModelClient({
      content: "解释一下 RSS 是什么",
      channelId: "chat-1",
      hasAttachments: false,
    }, client);

    expect(parsed.confidence).toBe(0.77);
    expect(parsed.matchedSignals).toContain("llm_classifier");
    expect(classifyCalls).toBe(1);
    expect(classifyInput).toEqual(expect.objectContaining({
      prompt: expect.stringContaining("Classify the capabilities needed"),
      responseFormat: "json",
      temperature: 0,
      maxTokens: 500,
      metadata: expect.objectContaining({
        purpose: "smart_router_classifier",
        channelId: "chat-1",
      }),
    }));
    expect(complete).not.toHaveBeenCalled();
    expect("capabilities" in client).toBe(false);
    expect("startTask" in client).toBe(false);
  });

  it("classifies through a lightweight OpenAI-compatible chat completion API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            needs_current_info: false,
            needs_multi_step_research: true,
            needs_file_write: true,
            needs_shell: true,
            needs_git: false,
            needs_browser: false,
            needs_runtime_inspection: false,
            needs_long_running: false,
            creates_persistent_output: true,
            has_external_url: false,
            has_attachments: false,
            is_url_only: false,
            estimated_effort: "medium",
            confidence: 0.91,
            reason: "needs local cron config update and trigger",
            evidence: ["cron_config_update"],
            risk_flags: ["writes_files"],
          }),
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const parsed = await __testables.classifyRouteWithOpenAiChat({
      content: "这个定时任务补充上 MiniClaw 定时任务，按执行时间排序，最后触发一下",
      channelId: "chat-1",
      hasAttachments: false,
    }, {
      provider: "openai_compatible",
      model: "router-mini",
      timeoutMs: 8000,
      baseUrl: "https://llm.example.test/v1/",
      fetchFn: fetchMock,
    });

    expect(parsed.needsFileWrite).toBe(true);
    expect(parsed.needsShell).toBe(true);
    expect(parsed.createsPersistentOutput).toBe(true);
    expect(parsed.confidence).toBe(0.91);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      model: "router-mini",
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You classify MiniClaw smart-router capabilities. Return JSON only.",
    });
    expect(body.messages[1]).toEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("Classify the capabilities needed"),
    }));
  });

  it("classifies through the Raven/Anthropic-compatible messages API", async () => {
    const createMock = vi.fn().mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          needs_current_info: false,
          needs_multi_step_research: true,
          needs_file_write: true,
          needs_shell: true,
          creates_persistent_output: true,
          estimated_effort: "medium",
          confidence: 0.88,
          reason: "needs local config update and trigger",
          evidence: ["raven_classifier"],
          risk_flags: ["writes_files"],
        }),
      }],
    });

    const parsed = await __testables.classifyRouteWithAnthropicMessages({
      content: "这个定时任务补充上 MiniClaw 定时任务，按执行时间排序，最后触发一下",
      channelId: "chat-1",
      hasAttachments: false,
    }, {
      model: "claude-router",
      timeoutMs: 8000,
      client: { messages: { create: createMock } } as never,
    });

    expect(parsed.needsFileWrite).toBe(true);
    expect(parsed.needsShell).toBe(true);
    expect(parsed.createsPersistentOutput).toBe(true);
    expect(parsed.confidence).toBe(0.88);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-router",
        max_tokens: 500,
        temperature: 0,
        messages: [{
          role: "user",
          content: expect.stringContaining("Classify the capabilities needed"),
        }],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("adds authorization when the lightweight classifier uses OpenAI API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ confidence: 0.7 }) } }],
    }), { status: 200 }));

    await __testables.classifyRouteWithOpenAiChat({
      content: "解释一下 RSS 是什么",
      channelId: "chat-1",
    }, {
      provider: "openai",
      model: "gpt-4o-mini",
      timeoutMs: 8000,
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
      })
    );
  });
});

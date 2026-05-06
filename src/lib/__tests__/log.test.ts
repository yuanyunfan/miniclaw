import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, __testables } from "../log.js";

afterEach(() => {
  delete process.env.MINICLAW_LOG_FORMAT;
  delete process.env.MINICLAW_LOG_LEVEL;
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("formatJsonLine 输出可解析的结构化日志", () => {
    const line = __testables.formatJsonLine(
      "info",
      "unit",
      ["hello", { taskId: "abc" }],
      new Date("2026-01-02T03:04:05.000Z"),
    );

    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      ts: "2026-01-02T03:04:05.000Z",
      level: "info",
      module: "unit",
      message: 'hello {"taskId":"abc"}',
    });
    expect(parsed.args[1]).toEqual({ taskId: "abc" });
  });

  it("json 模式写 JSON line", () => {
    process.env.MINICLAW_LOG_FORMAT = "json";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    createLogger("unit").info("ok", { count: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(spy.mock.calls[0][0]));
    expect(parsed).toMatchObject({ level: "info", module: "unit" });
    expect(parsed.args[1]).toEqual({ count: 1 });
  });

  it("error 不受 log level 过滤", () => {
    process.env.MINICLAW_LOG_LEVEL = "error";
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    createLogger("unit").info("hidden");
    createLogger("unit").error("visible");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

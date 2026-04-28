import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadState,
  recordRun,
  getJobState,
  getAllJobStates,
  resetStateCache,
} from "../state.js";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "miniclaw-cron-state-"));
  process.env.MINICLAW_CRON_STATE = join(dir, "state.json");
  resetStateCache();
});

describe("cron state 持久化", () => {
  it("文件不存在 → loadState 返回空 state", () => {
    const s = loadState();
    expect(s.jobs).toEqual({});
    expect(s.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("recordRun 写入并累加 completed", () => {
    const s1 = recordRun("job-a", true, 1234);
    expect(s1.completed).toBe(1);
    expect(s1.last_status).toBe("ok");
    expect(s1.last_duration_ms).toBe(1234);
    expect(s1.last_error).toBeUndefined();

    const s2 = recordRun("job-a", true, 567);
    expect(s2.completed).toBe(2);

    const s3 = recordRun("job-a", false, 999, "boom");
    expect(s3.completed).toBe(3);
    expect(s3.last_status).toBe("error");
    expect(s3.last_error).toBe("boom");
  });

  it("不同 job 各自计数", () => {
    recordRun("job-a", true, 100);
    recordRun("job-b", true, 200);
    recordRun("job-a", true, 300);
    expect(getJobState("job-a")?.completed).toBe(2);
    expect(getJobState("job-b")?.completed).toBe(1);
  });

  it("getAllJobStates 返回 snapshot", () => {
    recordRun("a", true, 10);
    recordRun("b", false, 20, "fail");
    const all = getAllJobStates();
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);
    expect(all.b.last_status).toBe("error");
  });

  it("recordRun 后文件原子写入到磁盘", () => {
    recordRun("persist-job", true, 42);
    const path = process.env.MINICLAW_CRON_STATE!;
    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.jobs["persist-job"].completed).toBe(1);
  });

  it("重启后（reset cache + 重读）保留计数", () => {
    recordRun("persist-job", true, 100);
    recordRun("persist-job", true, 200);
    resetStateCache(); // 模拟进程重启
    expect(getJobState("persist-job")?.completed).toBe(2);
  });

  it("损坏的 state.json → 返回空 state 不崩", () => {
    writeFileSync(process.env.MINICLAW_CRON_STATE!, "{ not json");
    const s = loadState();
    expect(s.jobs).toEqual({});
  });

  it("last_error 截断到 500 字符", () => {
    const longErr = "x".repeat(1000);
    const s = recordRun("err-job", false, 1, longErr);
    expect(s.last_error?.length).toBe(500);
  });
});

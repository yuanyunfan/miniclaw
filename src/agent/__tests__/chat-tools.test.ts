import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { __testables } from "../chat-tools.js";

const { execReadFile, execBash, execWebFetch, isPrivateHost } = __testables;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-chat-tools-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("execReadFile", () => {
  it("读取正常 utf8 文件", async () => {
    const p = join(tmp, "a.txt");
    writeFileSync(p, "hello\nworld");
    const r = await execReadFile(p);
    expect(r.is_error).toBe(false);
    expect(r.content).toBe("hello\nworld");
  });

  it("文件不存在 → error", async () => {
    const r = await execReadFile(join(tmp, "missing.txt"));
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/不存在/);
  });

  it("非绝对路径 → error", async () => {
    const r = await execReadFile("relative/foo.txt");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/绝对路径/);
  });

  it("空 path → error", async () => {
    const r = await execReadFile("");
    expect(r.is_error).toBe(true);
  });

  it("文件超 1MB → error 提示用 bash", async () => {
    const p = join(tmp, "big.txt");
    writeFileSync(p, Buffer.alloc(1_500_000, "x"));
    const r = await execReadFile(p);
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/过大|head|tail/);
  });

  it("拒绝读取 .env 文件", async () => {
    const p = join(tmp, ".env.local");
    writeFileSync(p, "TOKEN=secret");
    const r = await execReadFile(p);
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/敏感路径/);
  });

  it("拒绝读取 SSH key 路径，即使文件不存在", async () => {
    const r = await execReadFile("/home/miniclaw/.ssh/id_ed25519");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/敏感路径/);
  });
});

describe("execBash", () => {
  it("简单 echo 正确返回", async () => {
    const r = await execBash("echo hi");
    expect(r.is_error).toBe(false);
    expect(r.content.trim()).toBe("hi");
  });

  it("空 command → error", async () => {
    const r = await execBash("");
    expect(r.is_error).toBe(true);
  });

  it("失败命令返回 stderr 内容", async () => {
    const r = await execBash("ls /this/path/should/not/exist/anywhere/12345");
    expect(r.is_error).toBe(true);
    expect(r.content.length).toBeGreaterThan(0);
  });

  it("timeout 触发 → error 含 timeout 字样", async () => {
    const r = await execBash("sleep 5", 500);
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/超时|timeout/i);
  }, 10_000);

  it("超大 stdout 被截断", async () => {
    // 60KB 的 'a'，应被截断到 50KB
    const r = await execBash("yes a | head -c 60000");
    expect(r.is_error).toBe(false);
    expect(r.content.length).toBeLessThan(55_000);
    expect(r.content).toMatch(/截断/);
  });

  it("拒绝明显写入/破坏性命令", async () => {
    const r = await execBash("rm -rf /tmp/miniclaw-should-not-run");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/拒绝|只读/);
  });

  it("拒绝 shell 重定向写文件", async () => {
    const r = await execBash("echo hi > /tmp/miniclaw-should-not-write");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/重定向/);
  });

  it("拒绝会修改 git 状态的命令", async () => {
    const r = await execBash("git reset --hard HEAD");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/git/);
  });

  it("拒绝读取敏感路径的命令", async () => {
    const r = await execBash("cat ~/.ssh/id_ed25519");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/敏感路径/);
  });

  it("拒绝读取相对 .env 的命令", async () => {
    const r = await execBash("cat .env");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/敏感路径/);
  });
});

describe("isPrivateHost", () => {
  it.each([
    ["localhost", true],
    ["127.0.0.1", true],
    ["10.0.0.1", true],
    ["172.16.0.5", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["[::1]", true],
    ["localhost.", true],
    ["fd00::1", true],
    ["8.8.8.8", false],
    ["172.32.0.1", false],
    ["example.com", false],
    ["api.anthropic.com", false],
  ])("%s → %s", (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected);
  });
});

describe("execWebFetch", () => {
  it("空 url → error", async () => {
    const r = await execWebFetch("");
    expect(r.is_error).toBe(true);
  });

  it("file:// → error", async () => {
    const r = await execWebFetch("file:///etc/passwd");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/http/);
  });

  it("内网 IP → error", async () => {
    const r = await execWebFetch("http://127.0.0.1:8080/admin");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/内网/);
  });

  it("非法 URL → error", async () => {
    const r = await execWebFetch("not a url");
    expect(r.is_error).toBe(true);
  });

  it("正常 200 返回 body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("hello world", { status: 200, headers: { "content-type": "text/plain" } })
    );
    const r = await execWebFetch("https://example.com/foo");
    expect(r.is_error).toBe(false);
    expect(r.content).toBe("hello world");
  });

  it("HTTP 500 → error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("err", { status: 500, statusText: "Internal Server Error" })
    );
    const r = await execWebFetch("https://example.com/foo");
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/500/);
  });

  it("body 超过 100KB 被截断", async () => {
    const big = "a".repeat(150_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(big, { status: 200 })
    );
    const r = await execWebFetch("https://example.com/big");
    expect(r.is_error).toBe(false);
    expect(r.content.length).toBeLessThan(105_000);
    expect(r.content).toMatch(/截断/);
  });
});

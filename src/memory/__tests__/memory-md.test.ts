import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

let addMemory: typeof import("../../store/memory-md.js").addMemory;
let archiveMemory: typeof import("../../store/memory-md.js").archiveMemory;
let deleteMemory: typeof import("../../store/memory-md.js").deleteMemory;
let getAllMemories: typeof import("../../store/memory-md.js").getAllMemories;
let getMemoriesByType: typeof import("../../store/memory-md.js").getMemoriesByType;
let searchMemories: typeof import("../../store/memory-md.js").searchMemories;
let upsertMemory: typeof import("../../store/memory-md.js").upsertMemory;

beforeEach(async () => {
  // 每个测试隔离的 MEMORY.md
  const dir = mkdtempSync(join(tmpdir(), "miniclaw-mem-md-"));
  process.env.MINICLAW_MEMORY_PATH = join(dir, "MEMORY.md");
  vi.resetModules();
  ({ addMemory, archiveMemory, deleteMemory, getAllMemories, getMemoriesByType, searchMemories, upsertMemory } = await import("../../store/memory-md.js"));
});

describe("memory-md (markdown 存储)", () => {
  it("空文件 getAllMemories 返回 []", () => {
    expect(getAllMemories()).toEqual([]);
  });

  it("addMemory 创建文件 + section + 4 字符 hex id", () => {
    const r = addMemory("user", "test name", "test content");
    expect(r.id).toMatch(/^[a-f0-9]{4}$/);
    expect(r.type).toBe("user");
    expect(r.content).toBe("test content");
    expect(existsSync(process.env.MINICLAW_MEMORY_PATH!)).toBe(true);

    const md = readFileSync(process.env.MINICLAW_MEMORY_PATH!, "utf8");
    expect(md).toContain("## 🧑 user");
    expect(md).toContain("test content");
    expect(md).toContain(`id="${r.id}"`);
  });

  it("addMemory writes lifecycle metadata when provided", () => {
    const r = addMemory("feedback", "discord format", "Discord 输出不要使用 markdown pipe table", {
      source: "auto_extract",
      ttl: "stable",
      confidence: 0.91,
      canonical_key: "feedback:discordformat",
      now: "2026-05-14T00:00:00.000Z",
    });
    expect(r.source).toBe("auto_extract");
    const md = readFileSync(process.env.MINICLAW_MEMORY_PATH!, "utf8");
    expect(md).toContain('status="active"');
    expect(md).toContain('ttl="stable"');
    expect(md).toContain('source="auto_extract"');
    expect(md).toContain('confidence="0.91"');
    expect(md).toContain('canonical_key="feedback:discordformat"');
    expect(md).toContain('created_at="2026-05-14T00:00:00.000Z"');
  });

  it("addMemory 同 (type, name) 更新内容不重复", () => {
    const r1 = addMemory("user", "key", "v1");
    const r2 = addMemory("user", "key", "v2");
    expect(r2.id).toBe(r1.id);
    expect(r2.content).toBe("v2");
    const all = getAllMemories();
    expect(all.length).toBe(1);
    expect(all[0].content).toBe("v2");
  });

  it("addMemory 不同 (type, name) 各自存", () => {
    addMemory("user", "k1", "u1");
    addMemory("project", "k1", "p1"); // 同 name 不同 type
    addMemory("user", "k2", "u2");
    expect(getAllMemories().length).toBe(3);
  });

  it("deleteMemory by id 命中 + 不命中", () => {
    const r = addMemory("user", "x", "x content");
    expect(deleteMemory(r.id)).toBe(true);
    expect(getAllMemories().length).toBe(0);
    expect(deleteMemory("nope")).toBe(false);
  });

  it("getMemoriesByType 过滤", () => {
    addMemory("user", "u1", "user content");
    addMemory("project", "p1", "proj content");
    addMemory("reference", "r1", "ref content");
    expect(getMemoriesByType("user").map((r) => r.content)).toEqual(["user content"]);
    expect(getMemoriesByType("project").map((r) => r.content)).toEqual(["proj content"]);
    expect(getMemoriesByType("nonexistent").length).toBe(0);
  });

  it("searchMemories 大小写不敏感匹配 name 或 content", () => {
    addMemory("user", "alpha key", "Body Text");
    addMemory("user", "beta", "alpha in body");
    expect(searchMemories("ALPHA").length).toBe(2);
    expect(searchMemories("body").length).toBe(2);
    expect(searchMemories("nomatch").length).toBe(0);
  });

  it("非法 type 归入 user", () => {
    const r = addMemory("custom-bogus", "x", "x");
    expect(r.type).toBe("user");
    const md = readFileSync(process.env.MINICLAW_MEMORY_PATH!, "utf8");
    expect(md).toContain("## 🧑 user\nx");
  });

  it("round-trip：手写一份 markdown 后 getAllMemories 能解析", () => {
    const path = process.env.MINICLAW_MEMORY_PATH!;
    const md = `# MiniClaw Memory

## 🧑 user
hand-written user
<!-- id=aaaa -->
§
second user
<!-- id=bbbb -->

## 📋 project
（暂无）

## 💬 feedback
fb item
<!-- id=cccc -->

## 📚 reference
（暂无）
`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, md);
    const rows = getAllMemories();
    expect(rows.length).toBe(3);
    expect(rows.find((r) => r.id === "aaaa")?.content).toBe("hand-written user");
    expect(rows.find((r) => r.id === "bbbb")?.type).toBe("user");
    expect(rows.find((r) => r.id === "cccc")?.type).toBe("feedback");
  });

  it("round-trip：能解析扩展 metadata comment", () => {
    const path = process.env.MINICLAW_MEMORY_PATH!;
    const md = `# MiniClaw Memory

## 🧑 user
prefers Chinese
<!-- name="语言偏好" id=abcd status="active" ttl="stable" source="auto_extract" confidence="0.9" canonical_key="user:language" created_at="2026-05-14T00:00:00.000Z" updated_at="2026-05-14T00:00:00.000Z" -->

## 📋 project
（暂无）

## 💬 feedback
（暂无）

## 📚 reference
（暂无）
`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, md);
    const rows = getAllMemories();
    expect(rows[0]).toMatchObject({
      id: "abcd",
      name: "语言偏好",
      status: "active",
      ttl: "stable",
      source: "auto_extract",
      confidence: 0.9,
      canonical_key: "user:language",
      created_at: "2026-05-14T00:00:00.000Z",
    });
  });

  it("upsertMemory can update by target id even when name changes", () => {
    const r1 = addMemory("user", "old", "old content");
    const r2 = upsertMemory({
      type: "user",
      name: "new",
      content: "new content",
      source: "maintenance_merge",
      ttl: "stable",
    }, { targetId: r1.id, now: "2026-05-14T00:00:00.000Z" });
    expect(r2.id).toBe(r1.id);
    expect(getAllMemories()).toHaveLength(1);
    expect(getAllMemories()[0]).toMatchObject({ name: "new", content: "new content" });
  });

  it("archiveMemory marks a memory archived without deleting it", () => {
    const r = addMemory("project", "old status", "当前临时状态", { ttl: "volatile" });
    expect(archiveMemory(r.id, "stale", "2026-05-14T00:00:00.000Z")).toBe(true);
    expect(getAllMemories()[0]).toMatchObject({
      id: r.id,
      status: "archived",
      archived_at: "2026-05-14T00:00:00.000Z",
      archive_reason: "stale",
    });
  });

  it("缺 id 的条目被忽略（容错）", () => {
    const path = process.env.MINICLAW_MEMORY_PATH!;
    const md = `# MiniClaw Memory

## 🧑 user
no id here
§
has id
<!-- id=dddd -->

## 📋 project
（暂无）

## 💬 feedback
（暂无）

## 📚 reference
（暂无）
`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, md);
    const rows = getAllMemories();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("dddd");
  });
});

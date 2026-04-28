import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../subagents.js";

describe("parseFrontmatter", () => {
  it("parses simple key:value frontmatter", () => {
    const { meta, body } = parseFrontmatter(
      `---\ndescription: hello\nmodel: claude-opus-4-7\n---\nbody text`
    );
    expect(meta.description).toBe("hello");
    expect(meta.model).toBe("claude-opus-4-7");
    expect(body).toBe("body text");
  });

  it("parses YAML block scalar (|)", () => {
    const { meta } = parseFrontmatter(
      `---\ndescription: |\n  line one\n  line two\nmodel: opus\n---\nbody`
    );
    expect(meta.description).toBe("line one\nline two");
    expect(meta.model).toBe("opus");
  });

  it("parses flow array ([a, b, c])", () => {
    const { meta } = parseFrontmatter(
      `---\ntools: [Read, Grep, Glob, WebFetch]\n---\n`
    );
    expect(meta.tools).toEqual(["Read", "Grep", "Glob", "WebFetch"]);
  });

  it("strips quotes from quoted values", () => {
    const { meta } = parseFrontmatter(
      `---\ndescription: "quoted desc"\nname: 'single'\n---\n`
    );
    expect(meta.description).toBe("quoted desc");
    expect(meta.name).toBe("single");
  });

  it("throws when frontmatter delimiter missing", () => {
    expect(() => parseFrontmatter("no frontmatter here")).toThrowError(
      /YAML frontmatter/
    );
  });
});

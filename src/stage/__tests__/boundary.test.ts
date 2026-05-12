import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const srcRoot = join(repoRoot, "src");

interface ImportEdge {
  importer: string;
  specifier: string;
  resolved: string | null;
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "__fixtures__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(path));
      continue;
    }
    if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
      out.push(path);
    }
  }
  return out.sort();
}

function normalizeSourcePath(path: string): string {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function resolveImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const resolved = resolve(dirname(importer), specifier);
  return normalizeSourcePath(resolved)
    .replace(/\.js$/, ".ts")
    .replace(/\.jsx$/, ".tsx");
}

function collectImportEdges(files: string[]): ImportEdge[] {
  return files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return Array.from(source.matchAll(IMPORT_RE)).map((match) => {
      const specifier = match[1] ?? match[2]!;
      return {
        importer: normalizeSourcePath(file),
        specifier,
        resolved: resolveImport(file, specifier),
      };
    });
  });
}

function edgeSummary(edge: ImportEdge): string {
  return `${edge.importer} -> ${edge.specifier}`;
}

function startsWithAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

describe("Stage experimental import boundary", () => {
  it("keeps Stage modules out of Discord runtime and command handlers", () => {
    const stageFiles = walkSourceFiles(join(srcRoot, "stage"));
    const blockedPrefixes = [
      "src/bot.ts",
      "src/bot/",
      "src/commands/",
      "src/discord/",
    ];

    const violations = collectImportEdges(stageFiles)
      .filter((edge) => edge.resolved && startsWithAny(edge.resolved, blockedPrefixes))
      .map(edgeSummary);

    expect(violations).toEqual([]);
  });

  it("keeps Discord runtime modules from depending on Stage", () => {
    const discordRuntimeFiles = [
      join(srcRoot, "bot.ts"),
      ...walkSourceFiles(join(srcRoot, "bot")),
      ...walkSourceFiles(join(srcRoot, "commands")),
      ...walkSourceFiles(join(srcRoot, "discord")),
    ];

    const violations = collectImportEdges(discordRuntimeFiles)
      .filter((edge) => edge.resolved?.startsWith("src/stage/"))
      .map(edgeSummary);

    expect(violations).toEqual([]);
  });
});

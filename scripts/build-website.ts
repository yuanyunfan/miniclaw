#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseFrontmatter } from "../src/quality/frontmatter.js";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const websiteRoot = join(repoRoot, "website");
const outputRoot = join(repoRoot, process.env.MINICLAW_WEBSITE_OUT_DIR ?? "website-dist");

interface WebsitePage {
  outputPath: string;
  title: string;
  lang: "en" | "zh" | "root";
  body: string;
}

const navOrder = [
  "index.html",
  "design/architecture.html",
  "capabilities/providers.html",
  "guides/getting-started.html",
  "reference/quality-gates.html",
];

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function transformHref(href: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  return href.replace(/\.mdx?(#.*)?$/, ".html$1");
}

function inlineMarkdown(value: string): string {
  const codeSpans: string[] = [];
  let text = value.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `@@CODE_${codeSpans.length}@@`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  text = escapeHtml(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) =>
    `<a href="${escapeHtml(transformHref(href))}">${label}</a>`,
  );

  for (const [index, html] of codeSpans.entries()) {
    text = text.replaceAll(`@@CODE_${index}@@`, html);
  }
  return text;
}

function extractTitle(body: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? fallback;
}

function slugFor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  const flushCode = () => {
    const code = escapeHtml(codeLines.join("\n"));
    if (codeLang === "mermaid") {
      html.push(`<pre class="mermaid">${code}</pre>`);
    } else {
      const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
      html.push(`<pre><code${langClass}>${code}</code></pre>`);
    }
    codeLines = [];
  };

  for (const line of lines) {
    const fence = /^```([A-Za-z0-9_-]+)?\s*$/.exec(line);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
        codeLang = "";
      } else {
        closeList();
        inCode = true;
        codeLang = fence[1] ?? "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const title = heading[2].trim();
      html.push(`<h${level} id="${slugFor(title)}">${inlineMarkdown(title)}</h${level}>`);
      continue;
    }

    const listItem = /^-\s+(.+)$/.exec(line);
    if (listItem) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line.trim())}</p>`);
  }

  if (inCode) flushCode();
  closeList();
  return html.join("\n");
}

function walkMarkdown(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walkMarkdown(fullPath);
    return entry.endsWith(".md") || entry.endsWith(".mdx") ? [fullPath] : [];
  });
}

function outputPathFor(sourcePath: string): string {
  return toPosix(relative(websiteRoot, sourcePath)).replace(/\.mdx?$/, ".html");
}

function langFor(outputPath: string): WebsitePage["lang"] {
  if (outputPath.startsWith("en/")) return "en";
  if (outputPath.startsWith("zh/")) return "zh";
  return "root";
}

function relativeAsset(fromOutputPath: string, target: string): string {
  const rel = toPosix(relative(dirname(fromOutputPath), target));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function sectionPath(outputPath: string): string {
  return outputPath.replace(/^(en|zh)\//, "");
}

function navRank(page: WebsitePage): number {
  const index = navOrder.indexOf(sectionPath(page.outputPath));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function navLabel(page: WebsitePage): string {
  if (sectionPath(page.outputPath) !== "index.html") return page.title;
  return page.lang === "zh" ? "首页" : "Home";
}

function renderPage(page: WebsitePage, pages: WebsitePage[]): string {
  const nav = pages
    .filter((item) => item.lang === page.lang)
    .toSorted((a, b) => navRank(a) - navRank(b) || a.outputPath.localeCompare(b.outputPath))
    .map((item) => {
      const current = item.outputPath === page.outputPath ? ` aria-current="page"` : "";
      return `<a href="${escapeHtml(relativeAsset(page.outputPath, item.outputPath))}"${current}>${escapeHtml(navLabel(item))}</a>`;
    })
    .join("\n");
  const homePath = page.lang === "zh" ? "zh/index.html" : "en/index.html";

  return `<!doctype html>
<html lang="${page.lang === "zh" ? "zh-CN" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)} | MiniClaw</title>
  <link rel="stylesheet" href="${relativeAsset(page.outputPath, "assets/site.css")}">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="${relativeAsset(page.outputPath, homePath)}">MiniClaw</a>
    <nav class="site-nav">${nav}</nav>
  </header>
  <main class="content">
${renderMarkdown(page.body)}
  </main>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: true, theme: "default" });
  </script>
</body>
</html>
`;
}

function loadPages(): WebsitePage[] {
  return walkMarkdown(websiteRoot)
    .filter((path) => !path.endsWith("/llms.txt"))
    .map((sourcePath) => {
      const rel = toPosix(relative(websiteRoot, sourcePath));
      const parsed = parseFrontmatter(readFileSync(sourcePath, "utf8"));
      const outputPath = outputPathFor(sourcePath);
      return {
        outputPath,
        title: extractTitle(parsed.body, rel),
        lang: langFor(outputPath),
        body: parsed.body,
      };
    })
    .sort((a, b) => a.outputPath.localeCompare(b.outputPath));
}

function writeAssets(): void {
  const assetsDir = join(outputRoot, "assets");
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, "site.css"), `:root {
  color-scheme: light;
  --bg: #fbfbf8;
  --text: #1d2428;
  --muted: #5d686f;
  --line: #d9dedb;
  --accent: #0f766e;
  --accent-soft: #e5f3ef;
  --code: #f0f3f1;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.site-header {
  display: flex;
  gap: 24px;
  align-items: center;
  justify-content: space-between;
  padding: 16px clamp(20px, 5vw, 72px);
  border-bottom: 1px solid var(--line);
  background: rgba(251, 251, 248, 0.96);
  position: sticky;
  top: 0;
}
.brand {
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}
.site-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  justify-content: flex-end;
  font-size: 14px;
}
.site-nav a,
.content a {
  color: var(--accent);
  text-decoration: none;
}
.site-nav a:hover,
.content a:hover {
  text-decoration: underline;
}
.site-nav a[aria-current="page"] {
  color: var(--text);
  font-weight: 650;
}
.content {
  width: min(920px, calc(100vw - 40px));
  margin: 44px auto 72px;
}
h1, h2, h3 { line-height: 1.2; }
h1 {
  font-size: 42px;
  margin: 0 0 18px;
}
h2 {
  margin-top: 36px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
p, li { color: var(--muted); }
pre {
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--code);
}
code {
  border-radius: 4px;
  background: var(--code);
  padding: 0.1em 0.3em;
}
pre code {
  padding: 0;
  background: transparent;
}
.mermaid { background: var(--accent-soft); }
@media (max-width: 720px) {
  .site-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .site-nav { justify-content: flex-start; }
  h1 { font-size: 34px; }
}
`);
}

function build(): void {
  if (!existsSync(websiteRoot)) throw new Error("website directory does not exist");

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const pages = loadPages();
  for (const page of pages) {
    const fullOutput = join(outputRoot, page.outputPath);
    mkdirSync(dirname(fullOutput), { recursive: true });
    writeFileSync(fullOutput, renderPage(page, pages));
  }

  writeAssets();
  writeFileSync(join(outputRoot, ".nojekyll"), "");
  writeFileSync(join(outputRoot, "index.html"), `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=en/">
<link rel="canonical" href="en/">
<a href="en/">MiniClaw documentation</a>
`);

  const llmsPath = join(websiteRoot, "llms.txt");
  if (existsSync(llmsPath)) copyFileSync(llmsPath, join(outputRoot, "llms.txt"));

  console.log(`Built ${pages.length} website page(s) into ${toPosix(relative(repoRoot, outputRoot))}.`);
}

build();

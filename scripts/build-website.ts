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
import {
  frontmatterString,
  frontmatterStringRecord,
  parseFrontmatter,
} from "../src/quality/frontmatter.js";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const websiteRoot = join(repoRoot, "website");
const outputRoot = join(repoRoot, process.env.MINICLAW_WEBSITE_OUT_DIR ?? "website-dist");

interface WebsitePage {
  outputPath: string;
  title: string;
  lang: "en" | "zh" | "root";
  status: string;
  sourceDocs: Record<string, string[]>;
  body: string;
}

const navOrder = [
  "index.html",
  "design/architecture.html",
  "capabilities/runtime.html",
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

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) =>
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
  const labels: Record<string, string> = {
    "index.html": "Home",
    "design/architecture.html": "Architecture",
    "capabilities/runtime.html": "Runtime",
    "capabilities/providers.html": "Providers",
    "guides/getting-started.html": "Getting Started",
    "reference/quality-gates.html": "Quality Gates",
  };
  return labels[sectionPath(page.outputPath)] ?? page.title;
}

function repoSourceUrl(path: string): string {
  return `https://github.com/yuanyunfan/miniclaw/blob/main/${path}`;
}

function alternateLanguagePath(page: WebsitePage, pages: WebsitePage[]): string | undefined {
  if (page.lang === "root") return undefined;
  const targetLang = page.lang === "zh" ? "en" : "zh";
  return pages.find((candidate) =>
    candidate.lang === targetLang && sectionPath(candidate.outputPath) === sectionPath(page.outputPath)
  )?.outputPath;
}

function renderSourceDocs(page: WebsitePage): string {
  const entries = Object.entries(page.sourceDocs).flatMap(([lang, paths]) =>
    paths.map((path) => ({ lang, path })),
  );
  if (!entries.length) return "";
  const title = page.lang === "zh" ? "来源文档" : "Source Docs";
  const summary = page.lang === "zh"
    ? "本页是 curated website summary；实现 source of truth 仍然维护在 repo docs 中。"
    : "This website page is a curated summary. The implementation source of truth stays in the repo docs.";

  const items = entries
    .map((entry) =>
      `<li><span>${escapeHtml(entry.lang)}</span><a href="${escapeHtml(repoSourceUrl(entry.path))}">${escapeHtml(entry.path)}</a></li>`,
    )
    .join("\n");

  return `<section class="source-docs" aria-label="Source docs">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(summary)}</p>
    <ul>${items}</ul>
  </section>`;
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
  const alternate = alternateLanguagePath(page, pages);
  const alternateLink = alternate
    ? `<a class="language-link" href="${escapeHtml(relativeAsset(page.outputPath, alternate))}">${page.lang === "zh" ? "English" : "中文"}</a>`
    : "";
  const pageClass = page.status === "landing" ? "is-home" : "is-doc";

  return `<!doctype html>
<html lang="${page.lang === "zh" ? "zh-CN" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)} | MiniClaw</title>
  <meta name="description" content="MiniClaw technical documentation and architecture website.">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230f766e'/%3E%3Ctext x='32' y='39' font-size='20' text-anchor='middle' fill='white' font-family='Arial,sans-serif'%3EMC%3C/text%3E%3C/svg%3E">
  <script>
    (() => {
      const stored = localStorage.getItem("miniclaw-theme");
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = stored || (systemDark ? "dark" : "light");
    })();
  </script>
  <link rel="stylesheet" href="${relativeAsset(page.outputPath, "assets/site.css")}">
</head>
<body class="${pageClass} lang-${page.lang}">
  <div class="app-shell">
    <aside class="site-sidebar">
      <a class="brand" href="${relativeAsset(page.outputPath, homePath)}">
        <span class="brand-mark">MC</span>
        <span>
          <strong>MiniClaw</strong>
          <small>local-first agent runtime</small>
        </span>
      </a>
      <nav class="site-nav" aria-label="Primary navigation">${nav}</nav>
      <div class="sidebar-actions">
        ${alternateLink}
        <button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle dark mode">
          <span data-theme-label>Theme</span>
        </button>
      </div>
    </aside>
    <main class="site-main">
      <article class="content">
${renderMarkdown(page.body)}
${renderSourceDocs(page)}
      </article>
    </main>
  </div>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    const root = document.documentElement;
    const updateThemeLabels = () => {
      const label = root.dataset.theme === "dark" ? "Light" : "Dark";
      document.querySelectorAll("[data-theme-label]").forEach((item) => {
        item.textContent = label;
      });
    };
    updateThemeLabels();
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        localStorage.setItem("miniclaw-theme", next);
        updateThemeLabels();
      });
    });
    mermaid.initialize({
      startOnLoad: true,
      theme: root.dataset.theme === "dark" ? "dark" : "default",
    });
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
        status: frontmatterString(parsed.data, "status") ?? "public-summary",
        sourceDocs: frontmatterStringRecord(parsed.data, "source_docs"),
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
  --bg: #f7f8f5;
  --surface: #ffffff;
  --surface-raised: #fbfcf9;
  --sidebar: rgba(247, 248, 245, 0.92);
  --text: #172026;
  --muted: #5f6b70;
  --soft: #7b8784;
  --line: #dfe5df;
  --line-strong: #bdc9c0;
  --accent: #0f766e;
  --accent-2: #2563eb;
  --accent-3: #b45309;
  --accent-soft: #e5f3ef;
  --code: #eef3ef;
  --grid: rgba(15, 118, 110, 0.07);
  --shadow: 0 16px 42px rgba(23, 32, 38, 0.08);
}

html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1413;
  --surface: #151b1a;
  --surface-raised: #18201f;
  --sidebar: rgba(16, 23, 22, 0.94);
  --text: #edf2ef;
  --muted: #aab6b1;
  --soft: #87958f;
  --line: #2a3734;
  --line-strong: #45534f;
  --accent: #4db6ac;
  --accent-2: #8ab4f8;
  --accent-3: #f0b462;
  --accent-soft: #17312e;
  --code: #111917;
  --grid: rgba(77, 182, 172, 0.09);
  --shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
}

* { box-sizing: border-box; }

html { background: var(--bg); }

body {
  margin: 0;
  background:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px),
    var(--bg);
  background-size: 28px 28px, 28px 28px, auto;
  color: var(--text);
  font: 16px/1.65 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.app-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  min-height: 100vh;
}

.site-sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 28px;
  height: 100vh;
  padding: 28px 22px;
  border-right: 1px solid var(--line);
  background: var(--sidebar);
  backdrop-filter: blur(14px);
}

.brand {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  color: var(--text);
  text-decoration: none;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--accent);
  font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: var(--shadow);
}

.brand strong {
  display: block;
  font-size: 18px;
  line-height: 1.1;
}

.brand small {
  display: block;
  margin-top: 4px;
  color: var(--soft);
  font-size: 12px;
  line-height: 1.25;
}

.site-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.site-nav a {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--muted);
  font-size: 14px;
  text-decoration: none;
}

.site-nav a:hover {
  border-color: var(--line);
  background: var(--surface-raised);
  color: var(--text);
}

.site-nav a[aria-current="page"] {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--line));
  background: var(--accent-soft);
  color: var(--text);
  font-weight: 650;
}

.sidebar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: auto;
}

.language-link,
.theme-toggle {
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-decoration: none;
}

.theme-toggle { cursor: pointer; }

.language-link:hover,
.theme-toggle:hover {
  border-color: var(--line-strong);
}

.site-main {
  min-width: 0;
}

.content {
  width: min(1040px, calc(100vw - 360px));
  margin: 0 auto;
  padding: 56px 48px 84px;
}

.content a {
  color: var(--accent);
  text-decoration-color: color-mix(in srgb, var(--accent) 35%, transparent);
  text-underline-offset: 0.18em;
}

.content a:hover { text-decoration-color: var(--accent); }

h1, h2, h3 { line-height: 1.15; }

h1 {
  max-width: 780px;
  margin: 0 0 18px;
  font-size: 52px;
  letter-spacing: 0;
}

h2 {
  margin: 52px 0 14px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  font-size: 26px;
}

h3 {
  margin: 28px 0 10px;
  font-size: 19px;
}

p, li { color: var(--muted); }

p {
  max-width: 760px;
  margin: 0 0 16px;
}

strong { color: var(--text); }

ul {
  padding-left: 1.2rem;
}

li { margin: 6px 0; }

pre {
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--code);
}

code {
  border-radius: 4px;
  background: var(--code);
  padding: 0.1em 0.32em;
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

pre code {
  padding: 0;
  background: transparent;
}

.mermaid {
  margin: 24px 0 32px;
  background:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px),
    var(--surface);
  background-size: 22px 22px;
  box-shadow: var(--shadow);
}

body.is-home .content {
  width: min(1160px, calc(100vw - 340px));
  padding-top: 64px;
}

body.is-home h1 {
  max-width: 920px;
  font-size: 62px;
}

body.is-home .content > p:first-of-type {
  max-width: 820px;
  color: var(--text);
  font-size: 20px;
}

body.is-home .content > ul {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 22px 0 34px;
  padding: 0;
  list-style: none;
}

body.is-home .content > ul li {
  min-height: 118px;
  margin: 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.source-docs {
  margin-top: 56px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
}

.source-docs h2 {
  margin: 0 0 8px;
  padding: 0;
  border: 0;
  font-size: 18px;
}

.source-docs ul {
  display: grid;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.source-docs li {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  margin: 0;
}

.source-docs span {
  color: var(--soft);
  font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}

.source-docs a {
  overflow-wrap: anywhere;
}

@media (max-width: 960px) {
  .app-shell {
    display: block;
  }

  .site-sidebar {
    position: relative;
    height: auto;
    gap: 18px;
    padding: 18px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .site-nav {
    flex-direction: row;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .site-nav a {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .sidebar-actions {
    margin-top: 0;
  }

  .content,
  body.is-home .content {
    width: min(100%, 760px);
    padding: 38px 20px 64px;
  }

  h1,
  body.is-home h1 {
    font-size: 40px;
  }

  body.is-home .content > ul {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .brand {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .brand-mark {
    width: 40px;
    height: 40px;
  }

  h1,
  body.is-home h1 {
    font-size: 34px;
  }
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

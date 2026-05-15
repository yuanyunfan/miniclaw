---
status: public-summary
source_docs:
  en:
    - docs/quality-gates.md
    - docs/documentation-migration-map.md
  zh:
    - docs/zh/quality-gates.zh.md
---

# Quality Gates

MiniClaw treats quality gates as part of the architecture. They protect runtime behavior, docs, website summaries, bilingual parity, secrets, and release safety.

```mermaid
flowchart LR
  Change[Code / Docs Change] --> Commit[quality:commit]
  Commit --> Docs[quality:docs]
  Docs --> Drift[Docs Drift]
  Docs --> I18n[Docs i18n]
  Docs --> Website[Website Docs]
  Commit --> Static[Lint + Typecheck]
  Commit --> Tests[Vitest]
  Push[quality:push] --> Build[Build]
  Push --> Coverage[Coverage Ratchet]
  Push --> Cron[Cron E2E]
  Push --> Secrets[Secrets + G0]
  Push --> Deps[Dependency Scan]
```

## Drift Controls

- **`quality:docs:drift`** checks implementation-to-docs invariants.
- **`quality:docs-i18n`** checks bilingual doc pairing, metadata, and current translation parity.
- **`quality:website-docs`** checks website `source_docs` traceability and affected-page updates.
- **`quality:commit`** is the staged gate for normal local commits.
- **`quality:push`** expands into build, coverage, cron E2E, full-tree safety, secrets, and dependency checks.

## Website Contract

```mermaid
flowchart TD
  Source[Repo Source Docs] --> Page[Website Page]
  Page --> Frontmatter[source_docs]
  Frontmatter --> Gate[quality:website-docs]
  Gate --> Artifact[GitHub Pages Artifact]
  Artifact --> Pages[GitHub Pages Deploy]
```

The Pages workflow builds and validates the site every time. Deployment runs when GitHub Pages is enabled for the repository; otherwise the workflow uploads the built artifact for review.

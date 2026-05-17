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

MiniClaw treats quality gates as part of the architecture. They protect runtime behavior, docs, website summaries, bilingual parity, changelog hygiene, secrets, and release safety.

```mermaid
flowchart LR
  Change[Code / Docs Change] --> Commit[quality:commit]
  Commit --> Docs[quality:docs]
  Docs --> Drift[Docs Drift]
  Docs --> I18n[Docs i18n]
  Docs --> Website[Website Docs]
  Commit --> Changelog[Changelog Drift]
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
- **`quality:docs-i18n`** checks bilingual doc pairing, metadata, heading shape, language split, and source-hash parity.
- **`quality:website-docs`** keeps website summaries tied to repo docs without forcing internal implementation updates into public copy.
- **`quality:changelog`** blocks release-visible changes that do not update `CHANGELOG.md`.
- **`quality:commit`** is the staged gate for normal local commits.
- **`quality:push`** expands into build, coverage, cron E2E, full-tree safety, secrets, and dependency checks.

## Website Contract

```mermaid
flowchart TD
  Source[Repo Source Docs] --> Page[Website Page]
  Page --> PublicImpact[source_docs]
  Page --> TraceOnly[trace_docs]
  PublicImpact --> Gate[quality:website-docs]
  TraceOnly --> Gate
  Gate --> Artifact[GitHub Pages Artifact]
  Artifact --> Pages[GitHub Pages Deploy]
```

The Pages workflow builds and validates the site every time. Source changes that alter public summaries should update website pages; trace-only changes are reported for review without blocking the site.

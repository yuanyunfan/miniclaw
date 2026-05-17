---
status: public-summary
source_docs:
  en:
    - docs/providers/README.md
  zh:
    - docs/zh/providers/README.zh.md
trace_docs:
  en:
    - docs/providers/provider-framework.md
    - docs/providers/content.md
    - docs/providers/email.md
    - docs/providers/stock/README.md
    - docs/providers/stock/eastmoney.md
    - docs/providers/stock/research.md
  zh:
    - docs/zh/providers/provider-framework.zh.md
    - docs/zh/providers/content.zh.md
    - docs/zh/providers/email.zh.md
    - docs/zh/providers/stock/README.zh.md
    - docs/zh/providers/stock/eastmoney.zh.md
    - docs/zh/providers/stock/research.zh.md
---

# Providers

Providers are read-only context collectors. They run before an agent prompt, turn external data into structured text, and keep account-specific state outside the public repository.

```mermaid
flowchart TD
  Framework[Provider Framework] --> Contract[Contract: health / dry-run / output]
  Contract --> Content[Content Providers]
  Contract --> Email[Email Providers]
  Contract --> Stock[Stock Providers]
  Content --> WeChat[WeChat MP]
  Email --> Query[Email Query]
  Email --> CMB[CMB Credit Card Email]
  Stock --> Futu[Futu Stock]
  Stock --> Eastmoney[Eastmoney JYWG / ETF Premium / MyFavor]
  Stock --> Research[Portfolio / Pulse / Market Intel]
  Research --> Cron[Cron Reports]
  Query --> Cron
  WeChat --> Cron
```

## Provider Principles

- **Readonly first**: provider docs and code should make mutation boundaries explicit.
- **Structured before summarized**: providers gather facts; the LLM interprets and writes the report.
- **Session isolation**: cookies, app passwords, brokerage sessions, and account state stay in `~/.miniclaw/`.
- **Replayable failures**: no-data, auth-expired, and format-drift cases need fixture or dry-run coverage.
- **Family docs over legacy stubs**: provider contracts now live in `docs/providers/`; the old feature stubs have been merged and removed.

## Context Shape

```mermaid
flowchart LR
  Config[Provider Config] --> Collect[Collect]
  Collect --> Normalize[Normalize]
  Normalize --> Redact[Redact]
  Redact --> Render[Render Provider Output]
  Render --> Prompt[Task / Cron Prompt]
```

The website exposes the provider map. Implementation contracts, provider-specific setup, and drift-prone details remain in the linked source docs.

Stock portfolio reports can combine held-position evidence from Eastmoney JYWG with public ETF premium evidence from Eastmoney's fund selector. The public premium source is code-matched enrichment only; it is never treated as proof of account holdings.

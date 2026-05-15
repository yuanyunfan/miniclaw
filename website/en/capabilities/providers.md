---
status: public-summary
source_docs:
  en:
    - docs/providers/README.md
    - docs/providers/provider-framework.md
    - docs/providers/content.md
    - docs/providers/email.md
    - docs/providers/stock/README.md
    - docs/providers/stock/eastmoney.md
    - docs/providers/stock/research.md
  zh:
    - docs/zh/providers/README.zh.md
    - docs/zh/providers/provider-framework.zh.md
    - docs/zh/providers/content.zh.md
    - docs/zh/providers/email.zh.md
    - docs/zh/providers/stock/README.zh.md
    - docs/zh/providers/stock/eastmoney.zh.md
    - docs/zh/providers/stock/research.zh.md
---

# Providers

Providers prepare trusted context for cron jobs, tasks, and research workflows. The migration plan keeps provider implementation contracts in repo docs and exposes only curated summaries here.

```mermaid
flowchart TD
  ProviderFramework[Provider Framework] --> Health[Health Check]
  ProviderFramework --> DryRun[Dry Run]
  ProviderFramework --> Output[Structured Output]
  ProviderFramework --> Fixtures[Replay / No Data / Format Drift Fixtures]
  Eastmoney[Eastmoney Provider Family] --> JYWG[JYWG Readonly]
  Eastmoney --> MyFavor[MyFavor Watchlist]
  Email[Email Provider Family] --> EmailQuery[Generic Email Query]
  Email --> CMB[CMB Credit-card Parser]
  Content[Content Provider Family] --> WeChat[WeChat MP Metadata]
  Stock[Stock Provider Family] --> Futu[Futu Readonly]
  Stock --> Research[Stock Research Pipeline]
```

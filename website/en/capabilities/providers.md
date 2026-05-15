---
status: public-summary
source_docs:
  en:
    - docs/features/16-provider-framework.md
    - docs/features/09-eastmoney-jywg-readonly-provider.md
    - docs/features/17-eastmoney-myfavor-watchlist.md
  zh:
    - docs/zh/features/16-provider-framework.zh.md
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
```

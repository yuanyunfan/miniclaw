---
status: public-summary
source_docs:
  en:
    - docs/providers/README.md
    - docs/providers/provider-framework.md
    - docs/providers/email.md
    - docs/providers/stock/eastmoney.md
    - docs/providers/stock/research.md
  zh:
    - docs/zh/providers/provider-framework.zh.md
    - docs/zh/providers/email.zh.md
    - docs/zh/providers/stock/eastmoney.zh.md
---

# Providers

Providers 为 cron、task 和 research workflow 准备可信上下文。迁移计划要求 provider contract 保留在 repo docs 中，网站只展示整理后的摘要。

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
```

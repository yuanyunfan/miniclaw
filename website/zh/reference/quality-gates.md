---
status: public-summary
source_docs:
  en:
    - docs/quality-gates.md
    - docs/documentation-migration-map.md
  zh:
    - docs/zh/quality-gates.zh.md
---

# 质量门禁

MiniClaw 使用可执行 gate 来保持 code、docs、website pages 和双语文档一致。

- `quality:docs:drift`: code-to-docs source-of-truth drift。
- `quality:docs-i18n`: English/Chinese doc pairing 和 metadata。
- `quality:website-docs`: website page `source_docs` traceability。

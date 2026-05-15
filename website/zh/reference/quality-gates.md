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
- `quality:docs-i18n`: English/Chinese doc pairing、metadata 和 current translation parity。
- `quality:website-docs`: website page `source_docs` traceability；affected pages 未更新或未显式标记 unaffected 时会 blocking。
- Pages workflow：build 和 validation 总会执行；如果仓库还没有启用 GitHub Pages，则跳过 deploy 并上传普通 website artifact。

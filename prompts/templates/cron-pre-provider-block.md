---
description: cron pre_provider 输出注入到 task prompt 顶部的包装块（含三反引号代码围栏）
vars: [provider_name, output]
---
内置 provider `{{provider_name}}` 采集到的数据如下。

如果末尾出现 `... (truncated)`，只表示 MiniClaw 为控制 prompt 长度省略了尾部低优先级明细；请优先使用已经完整出现的顶层 summary 字段，不要补造被省略的数据。

```json
{{output}}
```

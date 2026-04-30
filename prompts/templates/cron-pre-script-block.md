---
description: cron pre_script 输出注入到 task prompt 顶部的包装块（含三反引号代码围栏）
kind: template
vars: [script_name, output]
---
## 📥 上方 script (`{{script_name}}`) 采集到的数据 (stdout)

```
{{output}}
```

---


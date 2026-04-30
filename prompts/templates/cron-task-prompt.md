---
description: cron type=task 触发时 prompt 的最外层包装（cron 标记 + 可选 pre_script 上下文 + 用户原始 prompt）
kind: template
vars: [job_name, prepended_context, user_prompt]
---
[cron:{{job_name}}]

{{prepended_context}}{{user_prompt}}

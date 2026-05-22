---
description: cron type=task 触发时 prompt 的最外层包装（cron 标记 + 可选上下文 + 可选输出契约 + 用户原始 prompt）
kind: template
vars: [job_name, prepended_context, output_contract, user_prompt]
---
[cron:{{job_name}}]

{{prepended_context}}{{output_contract}}{{user_prompt}}

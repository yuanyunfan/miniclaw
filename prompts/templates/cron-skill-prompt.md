---
description: cron type=skill 触发时拼装的 prompt（让 supervisor 显式调用某 skill）
kind: template
vars: [job_name, skill_name, args_block]
---
[cron:{{job_name}}] 请显式调用 {{skill_name}} skill 完成本次任务{{args_block}}

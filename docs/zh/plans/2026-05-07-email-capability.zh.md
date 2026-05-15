---
doc_id: email-capability-plan
lang: zh
translation_of: docs/plans/2026-05-07-email-capability.md
translation_status: current
source_sha256: 429f370cc143a0e35efcc924bed60e9734ce6aba8cb72d62547615478485c59d
---
# 电子邮件能力基金会

现况:已完成
日期:2026-05-07

## 背景情况

用户希望MiniClaw阅读每日信用卡通知电子邮件,并汇总支出到Discord. 这不应作为一次性的CMB信用卡刷卡机执行。 电子邮件访问是一种可重复使用的敏感数据能力,日后可以支持账单、发票、旅行邮件、订阅通讯和其他结构化工作流程。

现有的MiniClaw cron 工作支持`pre_provider`,其中提供者在LLM任务总结之前收集结构化数据。 WeChat 提供者是当前的例子.

## 目标

- 添加可重复使用,只读`src/capabilities/email`基础。
- 在Repo和外部供应商YAML之外保存邮箱证书。
- 支持实用的第一个适配器:只读 IMAP。
- 增加一个通用`email-query`用于控制邮箱查询的预提供者。
- 增加一个CMB信用卡电子邮件消费者,从电子邮件能力中分析交易通知电子邮件。
- 默认不保留原始电子邮件机体,也不使用写/删除/发送邮箱操作。
- 添加配置解析、编辑、状态、CMB解析和提供者格式化的重点测试。

## 非目标

- 在此切片中不要执行 Gmail OAuth 或 Microsoft Graph OAuth 。
- 不执行电子邮件发送、删除、移动、读标记、回复或转发。
- 不由用户提供专用的邮箱/配置, 不要创建实时用户邮箱 cron 工作 。
- 在看到真实样本之前,不要完美地分析每个可能的CMB电子邮件模板。

## 现有建筑证据

- `src/providers/types.ts`: `PreProviderRunner`合同。
- `src/providers/index.ts`: 供应商登记册。
- `src/cron/runner-task.ts`: `pre_provider`输出为任务提示准备 。
- `src/providers/wechat-mp/*`: 先前的结构化提供者模式。
- `docs/plans/README.md`: 修改认证/数据流/提供者执行所需的持久计划。

## 执行计划

1. 添加`src/capabilities/email`:
- 输入配置图和秘密加载;
- IMAP只读客户端;
- 消息查询模式;
- 编辑人员;
- 信息级解调器的状态助手。
2. 添加`src/providers/email-query`:
- 一般控制查询提供者;
- 输出编辑的JSON。
3. 添加`src/providers/cmb-credit-card-email`:
- 装入商务配置;
- 通过电子邮件能力查询电子邮件;
- 分析交易记录;
- 散列交易;
- 输出Discord/LLM-安全结构的JSON。
4. 登记册提供者`src/providers/index.ts`.
5. 增加文件:
- 通用电子邮件能力;
- CMB信用卡电子邮件消费者设置和限制。
6. 运行建设和测试套房。

## 核查计划

- 类型检查:`pnpm build`
- 重点测试:新的能力/提供者测试文件。
- 全套测试套房:`pnpm test`
- 静态安全检查:
- 在检索实例中没有电子邮件证书;
- 不暴露写/删除/发送信箱方法;
- 提供者输出不包括默认的原始体。

## 风险 倒车

- 风险:IMAP服务器差异可以打破直播信箱读取.
- 缓解:保持适配器的隔离,并通过接口级逻辑进行测试;只有在用户提供信箱细节后,才会添加活烟。
- 风险:CMB电子邮件模板不同。
- 缓解:解析器是保守的,由样本驱动;未解析的信息作为警告报告。
- 风险:将邮箱内容暴露于LLM.
- 缓解:默认提供者输出是结构化的、经编辑的和无身体的。
- 退后:删除`email-query` / `cmb-credit-card-email`从提供者登记处删除新的能力/提供者目录。

## 文档同步

- 添加内容`docs/archive/features/07-email-capability.md`.
- 添加内容`docs/archive/features/08-cmb-credit-card-email-provider.md`.
- 最新情况`docs/architecture.md`拥有新的基地能力。

## 执行笔记

- 已经添加了`src/capabilities/email`包含配置配置加载, 秘密加载, 仅读 IMAP 搜索, MIME 解析, 编辑, 以及信件的去dupe状态 。
- 已经添加了`email-query`和`cmb-credit-card-email`预供者.
- 注册了两个供应商`src/providers/index.ts`.
- 对配置、状态、编辑、格式化、剖析和收藏者行为增加重点测试。
- 为通用电子邮件能力和CMB信用卡电子邮件用户添加文件。

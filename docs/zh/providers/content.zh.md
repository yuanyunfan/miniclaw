---
doc_id: content-provider-family
lang: zh
translation_of: docs/providers/content.md
translation_status: pending
---

# Content Provider Family

> 这个中文文档当前是 tracked 摘要，占位对应 `docs/providers/content.md`。完整翻译完成后再把 `translation_status` 改为 `current`。

Content provider family 当前覆盖 `wechat-mp`：

- 通过 `mp.weixin.qq.com` 公众号后台 web session 读取文章列表 metadata。
- 只采集公众号、标题、摘要、发布时间、链接等 metadata。
- 使用固定北京时间窗口和 `state_path` dedupe，支持 09:00 / 17:00 两次日报。
- Provider 运行失败时不提交 dedupe state，避免未成功推送的文章被标记为已发送。
- Session 文件等价于公众号后台登录凭据，必须保存在用户本机 secret path，不能进入 repo、Discord、logs 或 LLM prompt。

迁移状态：

- `docs/features/02-wechat-mp-provider.md` 已变成兼容 stub，当前事实维护在英文 `docs/providers/content.md`。
- 中文完整翻译仍是 pending；在此之前，英文 content provider doc 是实现事实来源。

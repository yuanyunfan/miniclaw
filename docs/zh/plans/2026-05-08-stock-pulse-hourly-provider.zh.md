---
doc_id: stock-pulse-hourly-provider-plan
lang: zh
translation_of: docs/plans/2026-05-08-stock-pulse-hourly-provider.md
translation_status: current
source_sha256: cd9c67b113d40850e79802440f61be2119f6375ef12c0b92f3322863b9737aa4
---
# 股票脉冲小时Provider

现况:已完成
日期: 2026-05-08

## 要求

在CN/US交易窗口和用户北京时间运行窗口期间进行小时股票异常分析,时间为09:30至01:00. 将美国的结果发送给`daily-us-stock`和CN/HK结果`daily-cn-stock`.

## 执行情况

- 已经添加了`stock-pulse`预提供方。
- 在Provider代码中增加活跃窗口和市场会议警卫。
- 重用过`stock-portfolio`用于组合候选符号。
- 添加监视列表和宇宙-源支持.
- 添加了基于5m日内酒吧分析的雅虎图.
- 添加P2异常评分:
- 60米返回;
- 日复一日;
- 不正常的5米栏计数;
- 预期异常频率p95;
- 单向酒吧计票;
-60米Z分数
- 加入P3候选宇宙:
- 美国的雅虎预定义屏幕;
- CN/HK的Eastmoney clist源类型。
- 增加地方工作:
  - `~/.miniclaw/cron/us-stock-hourly-pulse.yaml`;
  - `~/.miniclaw/cron/cn-stock-hourly-pulse.yaml`.
- 添加本地Provider配置:
  - `~/.miniclaw/providers/stock-pulse/us-hourly.yaml`;
  - `~/.miniclaw/providers/stock-pulse/cn-hourly.yaml`.

## 验证

```bash
pnpm vitest run src/providers/stock-pulse
pnpm build
pnpm cron:list
```

## 页:1

第一个版本有意保持全市场扫描,以`universe.max_symbols`它扫描组合、监视名单以及公开的顶级候选人,然后对所有候选人使用同样的确定性酒吧级异常探测器。

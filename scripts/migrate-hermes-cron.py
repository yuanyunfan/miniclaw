#!/usr/bin/env python3
"""一次性把 ~/.hermes/cron/jobs.json 的 14 个 job 转成 ~/.miniclaw/cron/*.yaml"""
import json, re, os
from pathlib import Path

HERMES_JOBS = Path.home() / ".hermes/cron/jobs.json"
OUT_DIR = Path.home() / ".miniclaw/cron"
# 占位频道 ID — 迁移后用 scripts/update-cron-channels.py 批量替换
DEFAULT_CHANNEL = os.environ.get("MINICLAW_DEFAULT_CHANNEL_PLACEHOLDER", "REPLACE_WITH_DISCORD_CHANNEL_ID")

def slugify(name: str) -> str:
    # 中文 → 拼音不做，直接保留 ASCII 字符 + 把空格/中文换成 -
    s = re.sub(r"[^\w\s-]", "", name)
    s = re.sub(r"[\s_-]+", "-", s).strip("-").lower()
    if not s or s == "-":
        # 中文名字会被洗成空，用 hash fallback
        s = "job-" + str(abs(hash(name)) % 100000)
    return s

# 中文名 → 英文 slug 映射（手工映射好看一些）
NAME_MAP = {
    "GitHub Trending 每日简报": "github-trending",
    "每日AI热点新闻": "daily-ai-news",
    "stock_market": "stock-market-premarket",
    "A股港股盘后市场报告": "a-share-hk-postmarket",
    "hourly_token_dashboard": "hourly-token-report",
    "每日AI前沿动态": "daily-ai-frontier",
    "每日技术产品雷达": "daily-tech-radar",
    "arXiv AI论文日报": "daily-arxiv-papers",
    "中国热门新闻": "daily-china-news",
    "每日全球趋势热点": "daily-global-trending",
    "每日TLDR摘要": "daily-tldr",
    "每日App趋势报告": "daily-app-trending",
    "monitor repo release": "monitor-hermes-release",
    "全球热门新闻": "daily-global-news",
    "monitor repo release - ai-insight": "monitor-ai-insight-release",
}

# 6 个 hermes script 文件名 → miniclaw scripts/ 下软链同名
HERMES_SCRIPTS = {
    "daily_ai_usage_report.py": "daily-ai-usage-report.py",  # 早先用别名
    "daily_trending.py": "daily_trending.py",
    "daily_tldr.py": "daily_tldr.py",
    "daily_app_trending.py": "daily_app_trending.py",
    "hermes_update_check.py": "hermes_update_check.py",
    "monitor_ai_insight.py": "monitor_ai_insight.py",
}

def yaml_str(s: str) -> str:
    """安全 quote 单行字符串（无换行）"""
    if "\n" in s:
        raise ValueError("multiline 用 yaml block scalar 写")
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

def to_yaml(job: dict, slug: str) -> str:
    name = job["name"]
    schedule = job["schedule"]["expr"]
    prompt = job["prompt"]
    script = job.get("script")
    completed = job.get("repeat", {}).get("completed", 0)

    lines = []
    lines.append(f"# 来自 hermes 迁移：{name}（已运行 {completed} 次）")
    lines.append(f"# ⚠️  channel 默认指向 MiniClaw Hub #常规；若需独立频道，改 channel: 后重启")
    lines.append(f"name: {slug}")
    lines.append(f'schedule: "{schedule}"')
    lines.append(f"timezone: Asia/Shanghai")
    lines.append(f"enabled: false   # 默认关，避免一启动就 14 个 job 同时刷屏")
    lines.append(f"type: task")
    lines.append(f'channel: "{DEFAULT_CHANNEL}"')
    lines.append(f"budget_usd: 1.5")
    lines.append(f"max_turns: 30")

    if script:
        miniclaw_script = HERMES_SCRIPTS.get(script, script)
        lines.append(f"pre_script: {miniclaw_script}")
        lines.append(f"pre_script_timeout_sec: 300")

    lines.append(f"prompt: |")
    for ln in prompt.split("\n"):
        lines.append("  " + ln)

    return "\n".join(lines) + "\n"

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = json.loads(HERMES_JOBS.read_text())
    jobs = data["jobs"]
    out = []
    for job in jobs:
        name = job["name"]
        slug = NAME_MAP.get(name) or slugify(name)
        target = OUT_DIR / f"{slug}.yaml"
        # 跳过已有的（避免覆盖你已经手改的）
        if target.exists():
            print(f"⏭  {slug}.yaml 已存在，跳过（手动迁移）")
            out.append((slug, "skipped"))
            continue
        target.write_text(to_yaml(job, slug))
        out.append((slug, "ok"))
        print(f"✓ {slug}.yaml ({job['schedule']['expr']}, has_script={bool(job.get('script'))})")
    print(f"\n生成 {sum(1 for _,s in out if s=='ok')} 个新文件，跳过 {sum(1 for _,s in out if s=='skipped')} 个已有。")

if __name__ == "__main__":
    main()
